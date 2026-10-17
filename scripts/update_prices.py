#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch public Yahoo daily closes. No portfolio, quantity or cost is accepted."""
import argparse
import concurrent.futures
import datetime as dt
import json
import math
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
JST = dt.timezone(dt.timedelta(hours=9))
PATTERN = re.compile(r'^[0-9][0-9A-Z]{3}\.T$')
NAMES = {'7011.T':'三菱重工業','6976.T':'太陽誘電','7013.T':'IHI','7003.T':'三井E&S','7701.T':'島津製作所','7721.T':'東京計器','7740.T':'タムロン','8088.T':'岩谷産業','8359.T':'八十二長野銀行','7717.T':'ブイ・テクノロジー','1930.T':'北陸電気工事','6849.T':'日本光電','1605.T':'INPEX','1963.T':'日揮ホールディングス','2931.T':'ユーグレナ','3401.T':'帝人','3741.T':'セック','4540.T':'ツムラ','4563.T':'アンジェス','4570.T':'免疫生物研究所','4574.T':'大幸薬品','4792.T':'山田コンサルティンググループ','5631.T':'日本製鋼所','5801.T':'古河電気工業','6145.T':'NITTOKU','6268.T':'ナブテスコ','6301.T':'小松製作所','6302.T':'住友重機械工業','6310.T':'井関農機','6331.T':'三菱化工機','6387.T':'サムコ','6474.T':'不二越','6501.T':'日立製作所','6701.T':'NEC','6706.T':'電気興業','7203.T':'トヨタ自動車','6758.T':'ソニーグループ','8306.T':'三菱UFJフィナンシャル・グループ','9432.T':'NTT','9984.T':'ソフトバンクグループ'}

def normalized_symbols(text):
    symbols = set()
    for value in re.split(r'[,\s]+', text.strip().upper()):
        if not value:
            continue
        value = value if value.endswith('.T') else value + '.T'
        if not PATTERN.fullmatch(value):
            raise ValueError(f'Invalid Tokyo symbol: {value!r}')
        symbols.add(value)
    if len(symbols) > 300:
        raise ValueError('Maximum 300 symbols per request')
    return sorted(symbols)

def completed_cutoff(now):
    # Use the same cutoff for every security. Avoid intraday/partial daily bars.
    return now.date() if now.hour >= 17 else now.date() - dt.timedelta(days=1)

def parse_response(payload, symbol, now):
    chart = payload.get('chart', {})
    if chart.get('error') or not chart.get('result'):
        raise ValueError('Yahoo returned no chart data')
    result = chart['result'][0]
    meta = result.get('meta', {})
    if meta.get('symbol') != symbol or meta.get('currency') != 'JPY':
        raise ValueError('Unexpected symbol/currency; only JPY Tokyo securities supported')
    if meta.get('instrumentType') not in ('EQUITY', 'ETF'):
        raise ValueError('This security type is not supported')
    stamps = result.get('timestamp', [])
    values = result['indicators']['quote'][0]['close']
    if len(stamps) != len(values):
        raise ValueError('Mismatched timestamps and close values')
    cutoff = completed_cutoff(now)
    prices = {}
    for stamp, value in zip(stamps, values):
        day = dt.datetime.fromtimestamp(stamp, JST).date()
        if day <= cutoff and isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
            prices[day.isoformat()] = round(value, 6)
    if not prices:
        raise ValueError('No completed daily close data')
    splits = []
    for event in result.get('events', {}).get('splits', {}).values():
        day = dt.datetime.fromtimestamp(event['date'], JST).date()
        if day <= cutoff:
            splits.append({'date': day.isoformat(), 'ratio': event['numerator'] / event['denominator']})
    return {'name': NAMES.get(symbol) or meta.get('longName') or meta.get('shortName') or symbol,
            'currency': 'JPY', 'priceType': 'split-adjusted-close',
            'fetchedAt': now.isoformat(), 'prices': sorted(prices.items()),
            'splits': sorted(splits, key=lambda x: x['date'])}

def fetch_symbol(symbol, now):
    query = urllib.parse.urlencode({'range': '5y', 'interval': '1d', 'events': 'splits'})
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{query}'
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            return parse_response(payload, symbol, now)
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--symbols', default=os.environ.get('REQUESTED_SYMBOLS', ''))
    parser.add_argument('--registry', type=pathlib.Path, default=ROOT / 'market-symbols.json')
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'site/data/quotes.json')
    args = parser.parse_args()
    existing = json.loads(args.registry.read_text()) if args.registry.exists() else []
    requested = normalized_symbols(args.symbols)
    symbols = sorted(set(normalized_symbols(','.join(existing)) + requested))
    if not symbols or len(symbols) > 300:
        raise ValueError('Registry must contain between 1 and 300 Tokyo symbols')
    old = json.loads(args.output.read_text()) if args.output.exists() else {'symbols': {}}
    now = dt.datetime.now(JST)
    quotes, errors = {}, {}
    def update(symbol):
        try:
            return symbol, fetch_symbol(symbol, now), None
        except Exception as error:
            # Error classes only: no credentials/request contents are logged.
            return symbol, old.get('symbols', {}).get(symbol), f'取得失敗 ({type(error).__name__})'
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for symbol, quote, error in pool.map(update, symbols):
            if quote:
                quotes[symbol] = quote
            if error:
                errors[symbol] = error
            print(f'{symbol}: {"kept previous / failed" if error else "updated"}', flush=True)
    if not quotes:
        raise RuntimeError('No data available; existing data was not modified')
    data = {'schema': 1, 'source': 'Yahoo Finance public chart endpoint',
            'generatedAt': now.isoformat(), 'asOf': max(q['prices'][-1][0] for q in quotes.values()),
            'symbols': quotes, 'errors': errors}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    temp.replace(args.output)
    args.registry.write_text(json.dumps(symbols, indent=2) + '\n')
    print(f'Updated {len(quotes) - len([s for s in errors if s in quotes])}/{len(symbols)}; cutoff={completed_cutoff(now)}')
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a') as stream:
            stream.write(f'## 株価取得\n\n収録 {len(quotes)}銘柄 / 取得失敗 {len(errors)}銘柄\n\n')
            if errors:
                stream.write('取得失敗分は前回データを保持しています。\n\n' + '\n'.join(f'- {s}: {e}' for s, e in errors.items()))

if __name__ == '__main__':
    main()
