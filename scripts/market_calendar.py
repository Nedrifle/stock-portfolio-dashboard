"""Tokyo cash-market calendar and GitHub schedule routing (JST)."""
import datetime as dt
import os
import jpholiday

JST = dt.timezone(dt.timedelta(hours=9))

def trading_day(day):
    return day.weekday() < 5 and not jpholiday.is_holiday(day) and not (day.month == 1 and day.day <= 3) and not (day.month == 12 and day.day == 31)

def intraday_window(now):
    minute = now.hour * 60 + now.minute
    # A few minutes after each session allow its final trade to be collected.
    return trading_day(now.date()) and (540 <= minute <= 695 or 750 <= minute <= 935)

def plan(event, schedule, now):
    if event != 'schedule':
        return True, 'all'
    if schedule == '17 9 * * 1-5':
        return trading_day(now.date()), 'all'
    return intraday_window(now), 'intraday'

if __name__ == '__main__':
    run, mode = plan(os.environ.get('EVENT_NAME', ''), os.environ.get('EVENT_SCHEDULE', ''), dt.datetime.now(JST))
    text = f'run={str(run).lower()}\nmode={mode}\n'
    if path := os.environ.get('GITHUB_OUTPUT'):
        with open(path, 'a') as stream:
            stream.write(text)
    print(text)
