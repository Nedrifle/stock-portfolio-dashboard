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
  const rows = latestDate ? holdings.map((h, i) => {
    const close = maps[i].get(latestDate), value = close * h.quantity, costTotal = h.quantity * h.cost;
    return { ...h, close, value, costTotal, gain: value - costTotal, gainPct: costTotal ? (value / costTotal - 1) * 100 : null, date: latestDate, name: h.name || quotes[h.symbol].name || h.symbol };
  }) : [];
  const allDaily = dates.map(d => ({ date: d, value: holdings.reduce((v, h, i) => v + h.quantity * maps[i].get(d), 0) }));
  const daily = allDaily.filter(d => d.date >= start);
  const latest = rows.length ? { date: latestDate, value: rows.reduce((v, h) => v + h.value, 0), basis, gain: rows.reduce((v, h) => v + h.gain, 0) } : null;
  const peak = daily.reduce((a, d) => !a || d.value > a.value ? d : a, null);
  const lastDates = holdings.map(h => quotes[h.symbol].prices.at(-1)?.[0]).filter(Boolean);
  return { rows, daily, unavailable, peak, latest, latestMismatch: lastDates.some(d => d !== latestDate), coverageStart: dates[0], previous: allDaily.at(-2) || null };
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
