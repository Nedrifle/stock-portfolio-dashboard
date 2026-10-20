import datetime as dt
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('prices',pathlib.Path(__file__).resolve().parents[1]/'scripts/update_prices.py')
p=importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
cal_spec=importlib.util.spec_from_file_location('calendar',pathlib.Path(__file__).resolve().parents[1]/'scripts/market_calendar.py')
cal=importlib.util.module_from_spec(cal_spec); cal_spec.loader.exec_module(cal)

class PricesTest(unittest.TestCase):
    def payload(self):
        return {'chart':{'result':[{'meta':{'symbol':'5801.T','currency':'JPY','instrumentType':'EQUITY'},'timestamp':[1792047600,1792134000],'indicators':{'quote':[{'close':[3366,3400]}],'adjclose':[{'adjclose':[3200,3300]}]}}]}}
    def test_completed_cutoff(self):
        self.assertEqual(str(p.completed_cutoff(dt.datetime(2026,10,16,14,tzinfo=p.JST))),'2026-10-15')
    def test_close_not_dividend_adjusted(self):
        r=p.parse_response(self.payload(),'5801.T',dt.datetime(2026,10,17,12,tzinfo=p.JST))
        self.assertEqual(r['prices'][-1][1],3400)
    def test_reject_symbol_mismatch(self):
        with self.assertRaises(ValueError): p.parse_response(self.payload(),'7203.T',dt.datetime.now(p.JST))
    def test_input_is_not_executable(self):
        with self.assertRaises(ValueError): p.normalized_symbols('7203.T; echo bad')
        self.assertEqual(p.normalized_symbols('7203,285a.T'),['285A.T','7203.T'])
    def test_drop_bad_quotes(self):
        data=self.payload();data['chart']['result'][0]['indicators']['quote'][0]['close']=[None,-1]
        with self.assertRaises(ValueError):p.parse_response(data,'5801.T',dt.datetime(2026,10,17,tzinfo=p.JST))
    def test_live_quote_time_price_and_previous_close(self):
        data=self.payload(); meta=data['chart']['result'][0]['meta']
        meta.update(regularMarketPrice=3500,regularMarketTime=1792134000,chartPreviousClose=3300)
        q=p.parse_live(data,'5801.T',dt.datetime(2026,10,17,tzinfo=p.JST))
        self.assertEqual(q['price'],3500);self.assertEqual(q['previousClose'],3300)
        self.assertIn('+09:00',q['at'])
        with self.assertRaises(ValueError):p.parse_live(data,'5801.T',dt.datetime(2026,10,15,tzinfo=p.JST))
    def test_market_calendar_excludes_holidays_weekends_and_new_year(self):
        for date in [dt.date(2026,10,17),dt.date(2026,11,3),dt.date(2026,12,31),dt.date(2027,1,1)]:
            self.assertFalse(cal.trading_day(date))
        self.assertTrue(cal.trading_day(dt.date(2026,10,19)))
    def test_schedule_skips_lunch_and_afterhours_and_routes_evening(self):
        def now(h,m):return dt.datetime(2026,10,19,h,m,tzinfo=p.JST)
        self.assertTrue(cal.intraday_window(now(9,2)));self.assertTrue(cal.intraday_window(now(15,32)))
        self.assertFalse(cal.intraday_window(now(12,17)));self.assertFalse(cal.intraday_window(now(16,2)))
        self.assertEqual(cal.plan('schedule','17 9 * * 1-5',now(18,17)),(True,'all'))
        self.assertEqual(cal.plan('schedule','2,17,32,47 0-6 * * 1-5',now(12,17)),(True,'intraday'))
        self.assertEqual(cal.plan('schedule','2,17,32,47 0-6 * * 1-5',now(16,2)),(True,'intraday'))
        self.assertEqual(cal.plan('schedule','2,17,32,47 0-6 * * 1-5',now(17,2)),(False,'intraday'))
        self.assertEqual(cal.plan('workflow_dispatch','',now(12,17)),(True,'all'))
    def test_daily_history_never_includes_the_intraday_bar(self):
        r=p.parse_response(self.payload(),'5801.T',dt.datetime(2026,10,16,14,tzinfo=p.JST))
        self.assertTrue(all(day<'2026-10-16' for day,_ in r['prices']))

if __name__=='__main__':unittest.main()
