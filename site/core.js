export const SCHEMA = 1;
export function symbolOf(value) {
  const s = String(value || '').normalize('NFKC').trim().toUpperCase();
  if (!/^[0-9][0-9A-Z]{3}(\.T)?$/.test(s)) throw new Error('証券コードは4桁（例：7203、285A）で入力してください。');
  return s.endsWith('.T') ? s : `${s}.T`;
}
export function holdingOf(raw) {
  const quantity = Number(raw.quantity), cost = Number(raw.cost);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e10) throw new Error('保有株数は0より大きい数で入力してください。');
  if (String(raw.cost).trim() === '' || !Number.isFinite(cost) || cost < 0 || cost > 1e10) throw new Error('取得単価は0以上の数で入力してください。');
  return { id: raw.id || crypto.randomUUID(), symbol: symbolOf(raw.symbol), name: String(raw.name || '').trim().slice(0, 80), quantity, cost };
}
export function validateBackup(raw) {
  if (raw.schema !== SCHEMA || !Array.isArray(raw.portfolios) || !raw.portfolios.length || raw.portfolios.length > 100) throw new Error('対応するバックアップファイルではありません。');
  const ids = new Set();
  const portfolios = raw.portfolios.map(p => {
    if (!p || typeof p.id !== 'string' || ids.has(p.id) || !Array.isArray(p.holdings) || p.holdings.length > 1000) throw new Error('ポートフォリオの形式が正しくありません。');
    ids.add(p.id);
    const symbols = new Set();
    const holdings = p.holdings.map(h => {
      const item = holdingOf(h);
      if (symbols.has(item.symbol)) throw new Error('同一ポートフォリオ内で証券コードが重複しています。');
      symbols.add(item.symbol);
      return { ...item, id: crypto.randomUUID() };
    });
    return { id: p.id, name: String(p.name || 'ポートフォリオ').slice(0, 40), holdings };
  });
  return { schema: SCHEMA, portfolios, active: ids.has(raw.active) ? raw.active : portfolios[0].id };
}
// Use only common trading dates. Mixing stale and current prices understates risk.
export function analyze(holdings, quotes, { start = '', end = '9999-12-31' } = {}) {
  const unavailable = holdings.filter(h => !quotes?.[h.symbol]?.prices?.length).map(h => h.symbol);
  if (!holdings.length || unavailable.length) return { rows: [], daily: [], unavailable, peak: null, latest: null };
  const maps = holdings.map(h => new Map(quotes[h.symbol].prices));
  const dates = [...maps[0].keys()].filter(d => d <= end && maps.every(m => Number.isFinite(m.get(d)) && m.get(d) > 0)).sort();
  const basis = holdings.reduce((a, h) => a + h.quantity * h.cost, 0);
  const latestDate = dates.at(-1);
  let rows = latestDate ? holdings.map((h, i) => {
    const close = maps[i].get(latestDate), value = close * h.quantity, costTotal = h.quantity * h.cost;
    return { ...h, close, value, costTotal, gain: value - costTotal, gainPct: costTotal ? (value / costTotal - 1) * 100 : null, date: latestDate, name: h.name || quotes[h.symbol].name || h.symbol };
  }) : [];
  const allDaily = dates.map(d => ({ date: d, value: holdings.reduce((v, h, i) => v + h.quantity * maps[i].get(d), 0) }));
  const daily = allDaily.filter(d => d.date >= start);
  const historicalRows = rows;
  const validLive = h => {
    const l = quotes[h.symbol].live;
    return l && Number.isFinite(l.price) && l.price > 0 && Number.isFinite(Date.parse(l.at)) && l.at.slice(0, 10) >= latestDate;
  };
  const liveCount = rows.filter(validLive).length;
  if (liveCount) rows = rows.map((r, i) => {
    if (!validLive(r)) return {...r, priceKind:'close', priceAt:`${r.date}T15:30:00+09:00`};
    const l = quotes[r.symbol].live, value = r.quantity * l.price;
    return {...r, close:l.price, value, gain:value-r.costTotal, gainPct:r.costTotal ? (value/r.costTotal-1)*100 : null, priceKind:'latest', priceAt:l.at};
  });
  const quoteTimes = liveCount ? rows.map(r => r.priceAt).sort((a,b) => Date.parse(a)-Date.parse(b)) : [];
  const latest = rows.length ? { date: liveCount ? quoteTimes.at(-1).slice(0,10) : latestDate, value: rows.reduce((v, h) => v + h.value, 0), basis, gain: rows.reduce((v, h) => v + h.gain, 0),
    source: liveCount ? (liveCount === rows.length ? 'latest' : 'mixed') : 'close', oldestAt:quoteTimes[0], newestAt:quoteTimes.at(-1) } : null;
  const peak = daily.reduce((a, d) => !a || d.value > a.value ? d : a, null);
  const lastDates = holdings.map(h => quotes[h.symbol].prices.at(-1)?.[0]).filter(Boolean);
  let previous = allDaily.at(-2) || null;
  let bases = previous ? maps.map(m => m.get(previous.date)) : [];
  let comparisonDate = previous?.date;
  if (liveCount) {
    bases = rows.map((r,i) => {
      if (r.priceKind !== 'latest') return null;
      const l = quotes[r.symbol].live;
      if (Number.isFinite(l.previousClose) && l.previousClose > 0) return l.previousClose;
      return [...maps[i]].filter(([d]) => d < l.at.slice(0,10)).at(-1)?.[1] ?? null;
    });
    comparisonDate = rows[0]?.priceAt?.slice(0,10);
    const sameDay = rows.every(r => r.priceAt?.slice(0,10) === comparisonDate);
    previous = sameDay && bases.every(Number.isFinite) ? {value:holdings.reduce((v,h,i)=>v+h.quantity*bases[i],0)} : null;
  }
  const changeRows = previous ? rows.map((r,i) => ({...r, previousClose:bases[i], change:(r.close-bases[i])*r.quantity})) : [];
  const movement = changeRows.reduce((v,r) => v + Math.abs(r.change), 0);
  const dayChange = previous ? {value:changeRows.reduce((v,r)=>v+r.change,0), pct:previous.value ? (latest.value/previous.value-1)*100 : null,
    rows:changeRows.map(r => ({...r, share:movement ? Math.abs(r.change)/movement*100 : 0}))} : null;
  return { dayChange, rows, daily, unavailable, peak, latest, historyDate:latestDate, historicalRows, liveCount, latestMismatch: lastDates.some(d => d !== latestDate), coverageStart: dates[0], previous };
}
export function rangeStart(period, asOf) {
  if (!asOf) return '';
  const date = new Date(`${asOf}T00:00:00Z`);
  if (period === 'ytd') return `${date.getUTCFullYear()}-01-01`;
  if (period === 'all') return '';
  date.setUTCMonth(date.getUTCMonth() - Number(period));
  return date.toISOString().slice(0, 10);
}
export function waterfall(rows) {
  let total = 0;
  return [...rows].sort((a, b) => b.gain - a.gain).map(r => {
    const start = total; total += r.gain;
    return { ...r, start, end: total };
  });
}

export const CSV_HEADER = ['portfolio', 'symbol', 'name', 'quantity', 'cost'];
export function exportCSV(state) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [CSV_HEADER, ...state.portfolios.flatMap(p => p.holdings.map(h => [p.name, h.symbol, h.name, h.quantity, h.cost]))];
  return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
export function importCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else {
      if (closed || c === '"') throw new Error('CSVの引用符の形式が正しくありません。');
      field += c;
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません。');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  if (!rows.length || rows[0].map(v => v.trim()).join(',') !== CSV_HEADER.join(',')) throw new Error('CSVの見出しは portfolio,symbol,name,quantity,cost の順にしてください。');
  const groups = new Map();
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length !== CSV_HEADER.length) throw new Error(`CSVの${i + 1}行目の列数が正しくありません。`);
    const [portfolio, symbol, name, quantity, cost] = cells;
    if (!portfolio.trim() || portfolio.trim().length > 40) throw new Error(`CSVの${i + 1}行目のポートフォリオ名を確認してください。`);
    if (!quantity.trim()) throw new Error(`CSVの${i + 1}行目の株数が空欄です。`);
    const h = holdingOf({symbol, name, quantity, cost});
    const key = portfolio.trim();
    if (!groups.has(key)) groups.set(key, { id: crypto.randomUUID(), name: key, holdings: [] });
    groups.get(key).holdings.push(h);
  }
  const portfolios = [...groups.values()];
  return validateBackup({schema: SCHEMA, portfolios, active: portfolios[0]?.id});
}
