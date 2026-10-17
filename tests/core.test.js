import test from 'node:test';
import assert from 'node:assert/strict';
import { symbolOf, holdingOf, analyze, validateBackup, waterfall, rangeStart, importCSV, exportCSV } from '../site/core.js';
test('codes normalize Japanese full-width and alphanumeric Tokyo codes', () => {
  assert.equal(symbolOf('７２０３'), '7203.T'); assert.equal(symbolOf('285a'), '285A.T');
  assert.throws(() => symbolOf('../secret')); assert.throws(() => symbolOf('AAPL'));
});
const hs = [{id:'a',symbol:'5801.T',quantity:2000,cost:668.5}, {id:'b',symbol:'7011.T',quantity:2000,cost:2223}];
const quotes = {'5801.T':{prices:[['2026-06-22',5800],['2026-10-16',3366]]},'7011.T':{prices:[['2026-06-22',3909],['2026-10-16',3796]]}};
test('split-adjusted close times current shares preserves historic value and basis', () => {
  const r = analyze(hs, quotes); assert.equal(r.daily[0].value, 19418000); assert.equal(r.latest.basis, 5783000);
  assert.equal(r.peak.date, '2026-06-22'); assert.equal(r.latest.value, 14324000); assert.equal(r.latest.gain, 8541000);
});
test('missing symbol never silently shows partial portfolio total', () => {
  const r = analyze([...hs,{symbol:'7203.T',quantity:100,cost:100}],quotes); assert.equal(r.latest,null); assert.deepEqual(r.unavailable,['7203.T']);
});
test('all rows use the same common date; stale closes are not mixed', () => {
  const r = analyze(hs, {...quotes, '7011.T':{prices:[['2026-06-22',3909]]}});
  assert.equal(r.latest.date,'2026-06-22'); assert.equal(r.latest.value,19418000); assert.equal(r.latestMismatch,true);
});
test('range only changes chart, not latest valuation; empty interval has no peak', () => {
  const r = analyze(hs,quotes,{start:'2027-01-01'}); assert.equal(r.daily.length,0); assert.equal(r.peak,null); assert.equal(r.latest.value,14324000);
});
test('waterfall includes negative positions and sums exactly to the total', () => {
  const rows = waterfall([{gain:100},{gain:-40},{gain:20}]); assert.equal(rows.at(-1).end,80); assert.equal(rows.at(-1).start,120);
});
test('reject zero shares, NaN, missing costs and invalid backups', () => {
  assert.throws(() => holdingOf({symbol:'7203',quantity:0,cost:1}));
  assert.throws(() => holdingOf({symbol:'7203',quantity:1,cost:''}));
  assert.throws(() => holdingOf({symbol:'7203',quantity:NaN,cost:1}));
  assert.throws(() => validateBackup({schema:1,portfolios:[]}));
  assert.equal(holdingOf({symbol:'7203',quantity:100,cost:0}).cost,0);
});
test('reject duplicate symbol imports to prevent double counting', () => {
  assert.throws(() => validateBackup({schema:1,portfolios:[{id:'p',name:'x',holdings:[{symbol:'7203',quantity:100,cost:10},{symbol:'7203.T',quantity:100,cost:10}]}]}));
});
test('calendar ranges are based on latest market date, not device timezone', () => { assert.equal(rangeStart('ytd','2026-10-16'),'2026-01-01'); });
test('CSV roundtrip preserves fractional costs, BOM, commas, quotes, newlines and portfolios', () => {
  const state = {portfolios:[{name:'m',holdings:[{symbol:'7013.T',name:'テスト,"株"\n名称',quantity:700,cost:1330.142857}]},{name:'p',holdings:[{symbol:'7203.T',name:'トヨタ',quantity:100,cost:0}]}]};
  const result = importCSV(exportCSV(state));
  assert.equal(result.portfolios.length,2);
  assert.equal(result.portfolios[0].holdings[0].cost,1330.142857);
  assert.equal(result.portfolios[0].holdings[0].name,'テスト,"株"\n名称');
  assert.equal(result.portfolios[1].holdings[0].cost,0);
});
test('CSV rejects incomplete rows, empty costs and duplicate codes', () => {
  const header = 'portfolio,symbol,name,quantity,cost\n';
  for (const body of ['m,7203,トヨタ,100,','m,7203,トヨタ,,100','m,7203,トヨタ,100','m,7203,トヨタ,100,100\nm,7203,トヨタ,100,100','m,7203,"未完,100,100']) assert.throws(() => importCSV(header+body));
});
