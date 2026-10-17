import datetime as dt
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('prices',pathlib.Path(__file__).resolve().parents[1]/'scripts/update_prices.py')
p=importlib.util.module_from_spec(spec); spec.loader.exec_module(p)

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

if __name__=='__main__':unittest.main()
