import { SCHEMA, holdingOf, symbolOf, validateBackup, analyze, rangeStart, waterfall, gainHistory, exportCSV, importCSV } from './core.js?v=stock-gain-history-1';
const $ = id => document.getElementById(id);
const KEY = 'stockfolio.v1', CONFIG = 'stockfolio.settings.v1';
const yen = n => Number.isFinite(n) ? `¥${Math.round(n).toLocaleString('ja-JP')}` : '—';
const signed = n => Number.isFinite(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${yen(Math.abs(n))}` : '—';
const pct = n => Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';
const number = n => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 6 });
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dateJP = s => s ? s.replaceAll('-', '/') : '—';
const timeJP = s => s ? new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(s)) : '—';
const valuationLabel = l => l?.source === 'close' ? `${dateJP(l.date)} 終値` : l ? `${timeJP(l.oldestAt)}${l.oldestAt !== l.newestAt ? `〜${timeJP(l.newestAt)}` : ''} 時点${l.source === 'mixed' ? '（一部終値）' : ''}` : '';
const classOf = n => n < 0 ? 'negative' : n > 0 ? 'positive' : '';
const freshState = () => { const id = crypto.randomUUID(); return { schema: SCHEMA, active: id, portfolios: [{ id, name: 'マイポートフォリオ', holdings: [] }] }; };
let state, settings = {}, quoteData = { symbols: {} }, period = 'ytd', sort = 'value', sortDirection = -1, sample = false, result, toastTimer, rename = false, requestStarted = 0, busy = false, loadWarning = '';
let memoryToken = '', workflowTimer;
let valueVisible = false;
let activeView = 'overview', stockSymbol = '', stockPeriod = 'ytd';
try { state = localStorage.getItem(KEY) ? validateBackup(JSON.parse(localStorage.getItem(KEY))) : freshState(); }
catch { state = freshState(); loadWarning = '保存データを読み込めませんでした。元のデータは上書きしていません。バックアップから復元してください。'; }
try { settings = JSON.parse(localStorage.getItem(CONFIG) || '{}'); } catch { settings = {}; }
if (!settings.repo && location.hostname.endsWith('.github.io')) {
  const owner = location.hostname.split('.')[0], repository = location.pathname.split('/').filter(Boolean)[0];
  settings = { repo: `${owner}/${repository || `${owner}.github.io`}`, branch: 'main' };
}
function portfolio() { return state.portfolios.find(p => p.id === state.active) || state.portfolios[0]; }
const demo = [
  { id: 'demo-1', symbol: '7011.T', name: '三菱重工業', quantity: 100, cost: 2223 },
  { id: 'demo-2', symbol: '6501.T', name: '日立製作所', quantity: 100, cost: 3937 },
  { id: 'demo-3', symbol: '5801.T', name: '古河電気工業', quantity: 100, cost: 3000 },
  { id: 'demo-4', symbol: '4540.T', name: 'ツムラ', quantity: 100, cost: 4708 }
];
function holdings() { return sample ? demo : portfolio().holdings; }
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); loadWarning = ''; return true; }
  catch { toast('端末に保存できません。バックアップを書き出してください。'); return false; }
}
function toast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 6500); }
function notice(message, warning = false) { $('notice').classList.toggle('hidden', !message); $('notice').classList.toggle('warning', warning); $('notice').textContent = message; }
function openSettings() {
  $('repoInput').value = settings.repo || ''; $('branchInput').value = settings.branch || 'main'; $('tokenInput').value = memoryToken;
  $('settingsMessage').textContent = ''; $('settingsDialog').showModal();
}
async function loadQuotes(showMessage = false) {
  if (busy) return;
  busy = true; $('refreshButton').disabled = true;
  $('quoteStatus').textContent = '公開済みの株価を読み込んでいます…';
  try {
    const response = await fetch(`./data/quotes.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.schema !== 1 || !data.symbols || Object.values(data.symbols).some(q => !Array.isArray(q.prices))) throw new Error('株価データの形式を確認してください。');
    const unchanged = quoteData.generatedAt === data.generatedAt;
    quoteData = data;
    render();
    if (showMessage) {
      const missing = holdings().filter(h => !quoteData.symbols[h.symbol]);
      if (missing.length) { openSettings(); $('settingsMessage').textContent = `未取得：${missing.map(h => h.symbol).join('、')}。下のボタンからYahoo取得を実行してください。`; }
      else toast(unchanged ? `公開株価は前回と同じです（最終更新 ${timeJP(data.generatedAt)}）。Yahooから再取得するには「株価取得の設定」を開いてください。` : '公開済みの株価データを読み込みました。Yahooから再取得するには「株価取得の設定」を開いてください。');
    }
  } catch (error) {
    if (!result) render();
    $('quoteStatus').textContent = '株価データの読込に失敗';
    notice(`株価データを取得できませんでした（${error.message}）。接続を確認し、再度「最新データを読み込む」を押してください。`, true);
  } finally { busy = false; $('refreshButton').disabled = false; }
}
function render() {
  $('portfolioSelect').innerHTML = state.portfolios.map(p => `<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('');
  $('portfolioSelect').value = state.active;
  $('modeBadge').textContent = sample ? 'サンプル表示' : 'LOCAL';
  const hs = holdings(), quotes = quoteData.symbols || {};
  const latestKnown = hs.map(h => quotes[h.symbol]?.prices.at(-1)?.[0]).filter(Boolean).sort().at(-1);
  result = analyze(hs, quotes, { start: rangeStart(period, latestKnown) });
  $('holdingCount').textContent = `${hs.length}銘柄`;
  $('tableCount').textContent = hs.length;
  const l = result.latest;
  $('totalValue').textContent = valueVisible ? (l ? yen(l.value) : '—') : '××円';
  $('toggleValueButton').textContent = valueVisible ? '非表示' : '表示';
  $('toggleValueButton').setAttribute('aria-pressed', String(valueVisible));
  $('toggleValueButton').setAttribute('aria-label', valueVisible ? '概要の金額を非表示' : '概要の金額を表示');
  $('totalCost').textContent = !valueVisible ? '××円' : hs.length ? yen(hs.reduce((v, h) => v + h.quantity * h.cost, 0)) : '—';
  $('totalGain').textContent = !valueVisible ? '××円' : l ? signed(l.gain) : '—';
  $('totalGain').className = `metric-value ${valueVisible && l ? classOf(l.gain) : ''}`;
  $('gainRate').textContent = !valueVisible ? '損益率 ××%' : l ? `損益率 ${l.basis ? pct(l.gain / l.basis * 100) : '—（取得価額0円）'}` : '取得価額との比較';
  $('dayChange').textContent = !valueVisible ? '表示ボタンで金額を確認できます' : l && result.previous ? `前営業日比 ${signed(l.value - result.previous.value)}（${pct((l.value / result.previous.value - 1) * 100)}）` : '直近の終値で評価';
  $('quoteStatus').textContent = l ? `${valuationLabel(l)} · 公開株価更新 ${timeJP(quoteData.generatedAt)}` : hs.length ? '未取得の銘柄があります' : quoteData.generatedAt ? `公開株価更新 ${timeJP(quoteData.generatedAt)}` : '銘柄を登録してください';
  const nowJst = new Date(Date.now()+9*3600000), minuteJst = nowJst.getUTCHours()*60+nowJst.getUTCMinutes();
  const publicationDelayed = ![0,6].includes(nowJst.getUTCDay()) && minuteJst >= 540 && minuteJst <= 945 && Date.now()-Date.parse(quoteData.generatedAt)>45*60000;
  $('quoteStatus').classList.toggle('publication-delayed',publicationDelayed);
  if (publicationDelayed) $('quoteStatus').textContent += ' · 公開株価の更新が遅れています';
  let message = '', warn = false;
  if (sample) message = 'サンプルの4銘柄を表示しています。あなたの保有内容には保存されません。「銘柄を登録」で通常の画面に戻ります。';
  if (result.unavailable.length) { message = `未取得の銘柄：${result.unavailable.join('、')}。誤った合計を避けるため評価額は表示していません。「株価取得の設定」から取得してください。`; warn = true; }
  if (hs.length && !result.unavailable.length && !l) { message = '全銘柄に終値が存在する共通営業日がありません。株価取得の設定からデータを更新してください。'; warn = true; }
  if (result.latestMismatch) { message = `価格の収録日がそろっていないため、推移グラフを共通営業日 ${dateJP(result.historyDate)} までで集計しています。最新データを取得してください。`; warn = true; }
  const failed = hs.filter(h => quoteData.errors?.[h.symbol]);
  if (failed.length) { message = `${failed.map(h => h.symbol).join('、')} の最新取得に失敗しました。前回成功分の株価を表示しています。取得設定から再試行してください。`; warn = true; }
  const liveFailed = hs.filter(h => quoteData.liveErrors?.[h.symbol]);
  if (liveFailed.length) { message = `${liveFailed.map(h => h.symbol).join('、')} の直近株価取得に失敗しています。前回価格または確定終値を使用しています。価格時刻を確認してください。`; warn = true; }
  if (l?.source === 'mixed') { message = `一部銘柄の直近株価が未取得のため、確定終値を含む参考評価です。${message}`; warn = true; }
  if (l?.oldestAt) {
    const now = new Date(), minute = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}).format(now).split(':')[0])*60 + Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',minute:'2-digit'}).format(now));
    const weekday = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',weekday:'short'}).format(now);
    if (!['Sat','Sun'].includes(weekday) && ((minute>=540&&minute<=690)||(minute>=750&&minute<=930)) && now-Date.parse(l.oldestAt)>30*60000) { message = `30分以上前の価格を含みます。取得遅延や売買未成立の可能性があります。${message}`; warn = true; }
  }
  if (l) {
    const jstToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const age = (Date.parse(jstToday) - Date.parse(l.newestAt?.slice(0,10) || l.date)) / 86400000;
    if (age > 4) { message = `株価は ${dateJP(l.date)} までのデータです。最新終値ではない可能性があります。取得設定から更新してください。${message ? ` ${message}` : ''}`; warn = true; }
  }
  if (publicationDelayed) { message = `公開株価が45分以上更新されていません。読み込みボタンは公開済みデータを読み直します。Yahooからの再取得は「株価取得の設定」から実行できます。${message}`; warn = true; }
  if (loadWarning) { message = loadWarning; warn = true; }
  notice(message, warn);
  renderTrend(); renderWaterfall(); renderTable(); renderStockValue();
}
function renderTrend() { drawTrend(result); }
function drawTrend(analysis, prefix = '', label = '時価評価額の推移') {
  const id = name => prefix ? prefix + name[0].toUpperCase() + name.slice(1) : name;
  const chart = $(prefix ? `${prefix}TrendChart` : 'trendChart');
  const gain = prefix === 'stockGain', format = gain ? signed : yen;
  const { daily, peak, trough } = analysis;
  $(prefix ? `${prefix}TrendDates` : 'trendDates').textContent = daily.length ? `${dateJP(daily[0].date)} — ${dateJP(daily.at(-1).date)} · ${daily.length}営業日 · 確定終値` : '終値ベース・株式分割調整済み';
  $(prefix ? `${prefix}PeakLine` : 'peakLine').innerHTML = peak ? `<span>期間内の最高${gain ? '含み損益' : '評価額'} <strong>${format(peak.value)}</strong> ${dateJP(peak.date)}</span><span>期間内の最低${gain ? '含み損益' : '評価額'} <strong>${format(trough.value)}</strong> ${dateJP(trough.date)}</span>${gain ? `<span>直近終値の含み損益 <strong>${signed(daily.at(-1).value)}</strong></span>` : `<span>直近終値の最高額比 <strong>${pct((daily.at(-1).value / peak.value - 1) * 100)}</strong></span>`}` : '';
  if (!daily.length) { chart.innerHTML = '<div class="empty-chart">銘柄を登録すると評価額の推移が表示されます</div>'; return; }
  const W = Math.max(300, chart.clientWidth), H = chart.clientHeight || 270, left = 55, right = 18, top = 22, bottom = 32;
  const values = daily.map(d => d.value), min = Math.min(...values), max = Math.max(...values);
  const pad = (max - min) * .2 || Math.max(max * .1, 1000), low = gain ? Math.min(0,min)-pad : Math.max(0,min-pad), high = (gain ? Math.max(0,max) : max) + pad;
  const x = i => left + i / Math.max(1, daily.length - 1) * (W - left - right), y = v => top + (high - v) / (high - low) * (H - top - bottom);
  const path = daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(d.value).toFixed(2)}`).join(' ');
  const grid = Array.from({ length: 5 }, (_, i) => { const value = low + i / 4 * (high - low); const yy = y(value); return `<path d="M${left} ${yy}H${W - right}" stroke="#edf2e9"/><text x="${left - 12}" y="${yy + 3}" text-anchor="end" class="svg-label">${gain && Math.max(Math.abs(low),Math.abs(high)) < 10000 ? `${number(Math.round(value))}円` : `${number(gain ? Math.round(value/1000)/10 : Math.round(value/10000))}万`}</text>`; }).join('');
  const labelCount = Math.min(W < 500 ? 4 : 6, daily.length);
  const labelIndices = [...new Set(Array.from({ length: labelCount }, (_, i) => Math.round(i / Math.max(1, labelCount - 1) * (daily.length - 1))))];
  const labels = labelIndices.map(i => `<text x="${x(i)}" y="${H - 7}" text-anchor="middle" class="svg-label">${daily[i].date.slice(5).replace('-', '/')}</text>`).join('');
  const pi = daily.findIndex(d => d === peak), ti = daily.findIndex(d => d === trough);
  const gainColor = v => v < 0 ? '#d04444' : '#2878cf';
  const areaPath = `${path} L${x(daily.length-1)},${gain ? y(0) : H-bottom} L${left},${gain ? y(0) : H-bottom} Z`;
  const gainPlot = gain ? [{name:'profit',color:'#2878cf',yy:top,height:y(0)-top},{name:'loss',color:'#d04444',yy:y(0),height:H-bottom-y(0)}].map(part => `<defs><clipPath id="${id(part.name)}" clipPathUnits="userSpaceOnUse"><rect x="${left-4}" y="${part.yy}" width="${W-left-right+8}" height="${Math.max(0,part.height)}"/></clipPath></defs><g data-gain-sign="${part.name}" clip-path="url(#${id(part.name)})"><path d="${areaPath}" fill="${part.color}" fill-opacity=".14"/><path d="${path}" fill="none" stroke="${part.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>`).join('') : '';
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(label)}。期間最高${format(peak.value)}、${dateJP(peak.date)}。期間最低${format(trough.value)}、${dateJP(trough.date)}"><defs><linearGradient id="${id('area')}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a1c9ab" stop-opacity=".35"/><stop offset="1" stop-color="#d8e9d4" stop-opacity=".05"/></linearGradient></defs>${grid}${gain ? `<line x1="${left}" x2="${W-right}" y1="${y(0)}" y2="${y(0)}" stroke="#8fa799" stroke-dasharray="4 4"/>` : ''}${gain ? gainPlot : `<path d="${areaPath}" fill="url(#${id('area')})"/><path d="${path}" fill="none" stroke="#458363" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`}<circle cx="${x(pi)}" cy="${y(peak.value)}" r="4" fill="#fff" stroke="${gain ? gainColor(peak.value) : '#458363'}" stroke-width="2"/><circle cx="${x(ti)}" cy="${y(trough.value)}" r="4" fill="#fff" stroke="${gain ? gainColor(trough.value) : '#bd5e50'}" stroke-width="2"/>${labels}<line id="${id('hoverLine')}" x1="0" x2="0" y1="${top}" y2="${H - bottom}" stroke="#91af99" stroke-dasharray="4 4" opacity="0"/><circle id="${id('hoverDot')}" r="4" fill="#235c43" opacity="0"/><rect id="${id('hoverArea')}" x="${left}" y="0" width="${W - left - right}" height="${H}" fill="transparent"/></svg><div id="${id('chartTooltip')}" class="tooltip hidden"></div>`;
  const area = $(id('hoverArea')), tip = $(id('chartTooltip'));
  area.addEventListener('pointermove', e => {
    const rect = area.ownerSVGElement.getBoundingClientRect(), px = (e.clientX - rect.left) / rect.width * W;
    const i = Math.max(0, Math.min(daily.length - 1, Math.round((px - left) / (W - left - right) * (daily.length - 1))));
    const d = daily[i];
    $(id('hoverLine')).setAttribute('x1', x(i)); $(id('hoverLine')).setAttribute('x2', x(i)); $(id('hoverLine')).setAttribute('opacity', 1);
    if (gain) $(id('hoverDot')).setAttribute('fill',gainColor(d.value));
    $(id('hoverDot')).setAttribute('cx', x(i)); $(id('hoverDot')).setAttribute('cy', y(d.value)); $(id('hoverDot')).setAttribute('opacity', 1);
    tip.innerHTML = `<small>${dateJP(d.date)} 終値</small><br><strong>${format(d.value)}</strong>`;
    tip.classList.remove('hidden'); tip.style.left = `${Math.max(0, Math.min(rect.width - 170, e.clientX - rect.left + 12))}px`; tip.style.top = '0px';
  });
  area.addEventListener('pointerleave', () => { tip.classList.add('hidden'); $(id('hoverLine')).setAttribute('opacity', 0); $(id('hoverDot')).setAttribute('opacity', 0); });
}
function renderWaterfall() {
  renderDailyChange();
  drawWaterfall('waterfallChart', result.rows, result.latest?.gain, '含み損益内訳');
  $('breakdownDate').textContent = result.latest ? `${valuationLabel(result.latest)} · 取得価額との差額` : '銘柄ごとの貢献をウォーターフォールで表示';
}
function renderDailyChange() {
  const change = result.dayChange;
  $('dailyChangeTotal').textContent = change ? signed(change.value) : '—';
  $('dailyChangeTotal').className = change ? classOf(change.value) : '';
  $('dailyChangeRate').textContent = change ? pct(change.pct) : '';
  $('dailyChangeDate').textContent = change ? `${valuationLabel(result.latest)} · 前営業日終値比` : '比較できる前営業日の終値がそろうと表示します';
  drawWaterfall('dailyChangeChart', change?.rows.map(r => ({...r, gain:r.change})) || [], change?.value, '前日比増減の内訳', true);
}
function drawWaterfall(target, rows, total, title, daily = false) {
  if (!rows.length) { $(target).innerHTML = '<div class="empty-chart" style="height:220px">比較に必要な株価がそろうと内訳を表示します</div>'; return; }
  const bars = daily ? [...rows].sort((a,b) => Math.abs(b.gain)-Math.abs(a.gain) || a.symbol.localeCompare(b.symbol)).map(r => ({...r,start:0,end:r.gain})) : waterfall(rows), W = Math.max(320, $(target).clientWidth), left = W < 500 ? 96 : 165, right = W < 500 ? 88 : 125;
  const top = 42, step = 46, H = top + (bars.length + (daily ? 0 : 1)) * step + 12, bh = 20;
  const stops = [0, ...(daily ? [] : [total]), ...bars.flatMap(b => [b.start, b.end])], extent = Math.max(...stops.map(Math.abs)), lo = daily ? -extent : Math.min(...stops), hi = daily ? extent : Math.max(...stops), pad = (hi - lo) * .08 || 1000;
  const x = v => left + (v - lo + pad) / (hi - lo + 2 * pad) * (W - left - right);
  const axisLabel = n => Math.abs(n) >= 10000 ? `${number(Math.round(n / 1000) / 10)}万` : number(Math.round(n));
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px" role="img" aria-label="${title}${daily ? '。増減額の絶対値が大きい順' : `。合計${signed(total)}`}"><text x="${left}" y="12" class="svg-small">増減額（円）</text><text x="${W - 6}" y="12" class="svg-small" text-anchor="end">金額${daily ? ' / 構成比' : ''}</text>`;
  const ticks = W < 500 ? 3 : 5;
  for (let i = 0; i < ticks; i++) {
    const v = lo + i / (ticks - 1) * (hi - lo);
    svg += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 8}" y2="${H - 12}" stroke="#edf2e9"/><text x="${x(v)}" y="28" text-anchor="middle" class="svg-small">${axisLabel(v)}</text>`;
  }
  svg += `<line x1="${x(0)}" x2="${x(0)}" y1="${top - 8}" y2="${H - 12}" stroke="#b3c7ba"/>`;
  bars.forEach((b, i) => {
    const yy = top + step * i, xx = x(Math.min(b.start, b.end)), width = Math.max(1, Math.abs(x(b.end) - x(b.start)));
    svg += `<g><title>${escape(b.name)}：${signed(b.gain)}${daily ? `（構成比 ${b.share.toFixed(1)}%）` : ''}</title><text x="4" y="${yy + 9}" class="svg-small">${escape(b.name.slice(0, W < 500 ? 8 : 15))}</text><text x="4" y="${yy + 23}" class="svg-small">${escape(b.symbol.replace('.T', ''))}</text><rect x="${xx}" y="${yy}" width="${width}" height="${bh}" rx="2" fill="${b.gain >= 0 ? '#518b6e' : '#ca8070'}"/><text x="${W - 6}" y="${yy + 10}" class="svg-small" text-anchor="end">${signed(b.gain)}</text>${daily ? `<text x="${W - 6}" y="${yy + 25}" class="svg-small" text-anchor="end">${b.share.toFixed(1)}%</text>` : ''}${daily ? '' : `<line x1="${x(b.end)}" x2="${x(b.end)}" y1="${yy + bh}" y2="${yy + step}" stroke="#b8ccbe" stroke-dasharray="2 2"/>`}</g>`;
  });
  const yy = top + bars.length * step;
  if (!daily) svg += `<text x="4" y="${yy + 14}" class="svg-small">合計</text><rect x="${x(Math.min(0,total))}" y="${yy}" width="${Math.max(1,Math.abs(x(total)-x(0)))}" height="${bh}" fill="#254940" rx="2"/><text x="${W - 6}" y="${yy + 14}" class="svg-small" text-anchor="end">${signed(total)}</text></svg>`;
  if (daily) svg += '</svg>';
  $(target).innerHTML = svg;
}
function renderTable() {
  const hs = holdings(), query = $('searchInput').value.trim().toLowerCase(), bySymbol = new Map(result.rows.map(r => [r.symbol, r]));
  const rows = hs.map(h => bySymbol.get(h.symbol) || { ...h, name: h.name || quoteData.symbols[h.symbol]?.name || h.symbol, costTotal: h.cost * h.quantity });
  const filtered = rows.filter(r => `${r.name} ${r.symbol}`.toLowerCase().includes(query)).sort((a, b) => ((a[sort] ?? -Infinity) - (b[sort] ?? -Infinity)) * sortDirection);
  $('holdingsBody').innerHTML = filtered.map(r => `<tr><td class="name-cell">${escape(r.name)}<span class="symbol">${escape(r.symbol)} · 東証</span></td><td>${number(r.quantity)}株</td><td>${yen(r.cost)}</td><td>${yen(r.costTotal)}</td><td>${yen(r.close)}<span class="rate">${r.priceAt ? `${timeJP(r.priceAt)} ${r.priceKind==='close'?'終値':'時点'}` : r.date ? `${dateJP(r.date)} 終値` : ''}</span></td><td><strong>${yen(r.value)}</strong></td><td class="${classOf(r.gain)}"><strong>${signed(r.gain)}</strong><span class="rate">${pct(r.gainPct)}</span></td><td><button class="text-button" data-edit="${escape(r.id)}" ${sample ? 'disabled' : ''}>編集</button><button class="text-button" data-delete="${escape(r.id)}" ${sample ? 'disabled' : ''}>削除</button></td></tr>`).join('');
  if (hs.length && !filtered.length) $('holdingsBody').innerHTML = '<tr><td colspan="8" style="text-align:center;color:#8a9b8a">該当する銘柄がありません</td></tr>';
  const l = result.latest;
  $('holdingsFoot').innerHTML = l ? `<tr><td>全銘柄合計</td><td>${hs.length}銘柄</td><td>—</td><td>${yen(l.basis)}</td><td>—</td><td>${yen(l.value)}</td><td class="${classOf(l.gain)}">${signed(l.gain)}</td><td></td></tr>` : '';
  $('emptyState').classList.toggle('hidden', !!hs.length);
}
function editHolding(id) {
  if (sample) { sample = false; render(); }
  const h = portfolio().holdings.find(x => x.id === id);
  $('holdingTitle').textContent = h ? '銘柄を編集' : '銘柄を登録';
  $('holdingId').value = h?.id || ''; $('symbolInput').value = h?.symbol.replace('.T', '') || '';
  $('nameInput').value = h?.name || ''; $('quantityInput').value = h?.quantity ?? ''; $('costInput').value = h?.cost ?? '';
  $('holdingError').textContent = ''; $('holdingDialog').showModal();
}
function confirmAction(title, message) {
  $('confirmTitle').textContent = title; $('confirmText').textContent = message; $('confirmDialog').showModal();
  return new Promise(resolve => {
    let done = false;
    const finish = yes => { if (done) return; done = true; $('confirmDialog').close(); $('confirmOK').onclick = null; $('confirmCancel').onclick = null; $('confirmDialog').removeEventListener('cancel', cancel); resolve(yes); };
    const cancel = () => finish(false);
    $('confirmOK').onclick = () => finish(true); $('confirmCancel').onclick = cancel; $('confirmDialog').addEventListener('cancel', cancel);
  });
}
$('holdingForm').addEventListener('submit', e => {
  e.preventDefault();
  try {
    const item = holdingOf({ id: $('holdingId').value, symbol: $('symbolInput').value, name: $('nameInput').value, quantity: $('quantityInput').value, cost: $('costInput').value });
    const p = portfolio();
    if (p.holdings.some(h => h.symbol === item.symbol && h.id !== item.id)) throw new Error('この銘柄は登録済みです。既存の銘柄を編集してください。');
    p.holdings = [...p.holdings.filter(h => h.id !== item.id), item];
    persist(); $('holdingDialog').close(); render(); toast('銘柄を保存しました。');
  } catch (error) { $('holdingError').textContent = error.message; }
});
$('holdingsBody').addEventListener('click', async e => {
  const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-delete]');
  if (sample) return;
  if (edit) editHolding(edit.dataset.edit);
  if (del && await confirmAction('銘柄を削除しますか？', 'この端末のポートフォリオから削除します。公開株価データは残ります。')) {
    portfolio().holdings = portfolio().holdings.filter(h => h.id !== del.dataset.delete); persist(); render(); toast('銘柄を削除しました。');
  }
});
$('addButton').onclick = $('emptyAdd').onclick = () => editHolding();
$('sampleButton').onclick = () => { sample = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
$('portfolioSelect').onchange = e => { state.active = e.target.value; sample = false; valueVisible = false; persist(); render(); };
$('toggleValueButton').onclick = () => { valueVisible = !valueVisible; render(); };
function portfolioDialog(isRename) { rename = isRename; $('portfolioTitle').textContent = rename ? 'ポートフォリオ名を変更' : 'ポートフォリオを作成'; $('portfolioName').value = rename ? portfolio().name : ''; $('portfolioDialog').showModal(); }
$('addPortfolio').onclick = () => portfolioDialog(false); $('renamePortfolio').onclick = () => portfolioDialog(true);
$('portfolioForm').onsubmit = e => { e.preventDefault(); const name = $('portfolioName').value.trim(); if (!name) return; if (rename) portfolio().name = name; else { const id = crypto.randomUUID(); state.portfolios.push({ id, name, holdings: [] }); state.active = id; } sample = false; persist(); $('portfolioDialog').close(); render(); };
$('searchInput').oninput = renderTable;
document.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { sortDirection = sort === b.dataset.sort ? -sortDirection : -1; sort = b.dataset.sort; renderTable(); });
document.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { period = b.dataset.period; document.querySelectorAll('[data-period]').forEach(x => x.classList.toggle('selected', x === b)); render(); });
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
$('helpButton').onclick = () => $('helpDialog').showModal(); $('settingsButton').onclick = openSettings;
$('topSettingsButton').onclick = openSettings;
$('dataMenuButton').onclick = () => $('dataMenuDialog').showModal();
$('mobileBackup').onclick = () => { $('dataMenuDialog').close(); $('backupButton').click(); };
$('mobileImport').onclick = () => { $('dataMenuDialog').close(); $('importButton').click(); };
$('csvBackupButton').onclick = () => {
  const blob = new Blob([exportCSV(state)], {type: 'text/csv;charset=utf-8'}), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `stockfolio-backup-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('refreshButton').onclick = () => loadQuotes(true);
$('backupButton').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `stockfolio-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('importButton').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 5e6) throw new Error('ファイルは5MB以内にしてください。');
    const text = await file.text();
    const backup = file.name.toLowerCase().endsWith('.csv') ? importCSV(text) : validateBackup(JSON.parse(text));
    if (await confirmAction('バックアップを読み込みますか？', `この端末の全ポートフォリオを、ファイル内の${backup.portfolios.length}件で置き換えます。必要なら先に書き出してください。`)) { state = backup; sample = false; persist(); render(); toast('バックアップを復元しました。'); }
  } catch (error) { toast(`読込に失敗しました：${error.message}`); }
  e.target.value = '';
};
function configFromForm() {
  const repo = $('repoInput').value.trim(), branch = $('branchInput').value.trim() || 'main';
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('リポジトリを owner/repository の形式で入力してください。');
  if (!/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..')) throw new Error('ブランチ名を確認してください。');
  return { repo, branch };
}
$('saveSettings').onclick = () => { try { settings = configFromForm(); localStorage.setItem(CONFIG, JSON.stringify(settings)); memoryToken = $('tokenInput').value.trim(); $('settingsDialog').close(); toast('取得設定を保存しました。トークンは端末には保存していません。'); } catch (e) { $('settingsMessage').textContent = e.message; } };
$('workflowButton').onclick = () => { try { const c = configFromForm(); window.open(`https://github.com/${c.repo}/actions/workflows/update-prices.yml`, '_blank', 'noopener,noreferrer'); } catch (e) { $('settingsMessage').textContent = e.message; } };
async function github(path, config, token, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${config.repo}${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}`, ...options.headers } });
  if (!res.ok) {
    if (res.status === 401) throw new Error('トークンが無効、または期限切れです。');
    if (res.status === 403 || res.status === 404) throw new Error('対象リポジトリのActions読み書き権限とワークフローの配置を確認してください。');
    throw new Error(`GitHubへのリクエストに失敗しました（${res.status}）。`);
  }
  return res.status === 204 ? null : res.json();
}
$('dispatchButton').onclick = async () => {
  try {
    const config = configFromForm(), token = $('tokenInput').value.trim() || memoryToken;
    if (!token) throw new Error('GitHub tokenを入力するか、「GitHubで実行画面を開く」から実行してください。');
    const symbols = [...new Set(state.portfolios.flatMap(p => p.holdings.map(h => symbolOf(h.symbol))))].join(',');
    if (!symbols) throw new Error('先に銘柄を登録してください。');
    $('dispatchButton').disabled = true; $('settingsMessage').textContent = '株価取得を依頼しています…';
    const previous = await github('/actions/workflows/update-prices.yml/runs?event=workflow_dispatch&per_page=20', config, token);
    const oldIds = new Set(previous.workflow_runs.map(r => r.id));
    requestStarted = Date.now();
    await github('/actions/workflows/update-prices.yml/dispatches', config, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: config.branch, inputs: { symbols } }) });
    memoryToken = token; settings = config; localStorage.setItem(CONFIG, JSON.stringify(settings));
    $('settingsMessage').textContent = 'Yahoo株価をGitHubで取得中です。完了まで数分かかります。このページを開いたままお待ちください。';
    clearTimeout(workflowTimer);
    const poll = async () => {
      try {
        const runs = await github('/actions/workflows/update-prices.yml/runs?event=workflow_dispatch&per_page=20', config, memoryToken);
        const run = runs.workflow_runs.find(r => !oldIds.has(r.id) && r.head_branch === config.branch && Date.parse(r.created_at) >= requestStarted - 10000);
        if (run?.status === 'completed') {
          if (run.conclusion !== 'success') throw new Error('取得・公開に失敗しました。GitHubの実行画面で詳細を確認してください。以前の株価データは保持しています。');
          $('settingsMessage').textContent = '取得と公開が完了しました。最新データを読み込みます。';
          await loadQuotes(false); $('dispatchButton').disabled = false; toast('株価の取得・公開が完了しました。'); return;
        }
        if (Date.now() - requestStarted > 10 * 60000) throw new Error('処理が長引いています。GitHubの実行画面で確認し、完了後に「最新データを読み込む」を押してください。');
        workflowTimer = setTimeout(poll, 15000);
      } catch (error) { $('settingsMessage').textContent = error.message; $('dispatchButton').disabled = false; }
    };
    workflowTimer = setTimeout(poll, 15000);
  } catch (error) { $('settingsMessage').textContent = error.message; $('dispatchButton').disabled = false; }
};

function setView(view) {
  activeView = view;
  for (const [name, tab, panel] of [['overview','overviewTab','overviewPanel'],['stock','stockValueTab','stockValuePanel']]) {
    const selected = name === view;
    $(tab).setAttribute('aria-selected',String(selected)); $(tab).tabIndex = selected ? 0 : -1;
    $(panel).classList.toggle('hidden',!selected);
  }
  if (view === 'stock') renderStockValue(); else { renderTrend(); renderWaterfall(); }
}
function renderStockValue() {
  const hs = holdings(), quotes = quoteData.symbols || {};
  if (!hs.some(h=>h.symbol === stockSymbol)) stockSymbol = hs[0]?.symbol || '';
  $('stockValueSelect').innerHTML = hs.length ? hs.map(h=>`<option value="${escape(h.symbol)}">${escape(h.name || quotes[h.symbol]?.name || h.symbol)}（${escape(h.symbol)}）</option>`).join('') : '<option value="">登録銘柄がありません</option>';
  $('stockValueSelect').value = stockSymbol; $('stockValueSelect').disabled = !hs.length;
  const h = hs.find(h=>h.symbol === stockSymbol), name = h ? h.name || quotes[h.symbol]?.name || h.symbol : '';
  $('stockTrendTitle').textContent = name ? `${name}の時価評価額の推移` : '時価評価額の推移';
  const asOf = h ? quotes[h.symbol]?.prices?.at(-1)?.[0] : null;
  const data = analyze(h ? [h] : [],quotes,{start:rangeStart(stockPeriod,asOf)});
  $('stockValueInfo').textContent = h ? `${h.symbol} · 保有株数 ${number(h.quantity)}株${data.unavailable.length ? ' · 株価が未取得です。株価取得の設定から取得してください。' : ''}` : '銘柄を登録すると選択できます。';
  $('stockGainTitle').textContent = name ? `${name}の含み損益の推移` : '含み損益の推移';
  if (activeView === 'stock') {
    drawTrend(data,'stock',`${name}の時価評価額の推移`);
    drawTrend(gainHistory(data,h ? h.quantity*h.cost : null),'stockGain',`${name}の含み損益の推移`);
  }
}
document.querySelectorAll('a[href="#overview"], a[href="#holdings"]').forEach(a => a.addEventListener('click', () => setView('overview')));
$('overviewTab').onclick = () => setView('overview');
$('stockValueTab').onclick = () => setView('stock');
for (const tab of [$('overviewTab'),$('stockValueTab')]) tab.onkeydown = e => {
  if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); const view = e.key==='Home' ? 'overview' : e.key==='End' ? 'stock' : activeView==='overview' ? 'stock' : 'overview'; setView(view); $(view==='overview'?'overviewTab':'stockValueTab').focus(); }
};
$('stockValueSelect').onchange = e => { stockSymbol = e.target.value; renderStockValue(); };
document.querySelectorAll('[data-stock-period]').forEach(b => b.onclick = () => { stockPeriod = b.dataset.stockPeriod; document.querySelectorAll('[data-stock-period]').forEach(x=>x.classList.toggle('selected',x===b)); renderStockValue(); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderTrend(); renderWaterfall(); renderStockValue(); }, 120); });
render(); loadQuotes();
// Read the shared cache while the app is visible; do not trigger Yahoo requests
// or GitHub workflows from each visitor's phone.
setInterval(() => { if (document.visibilityState === 'visible') loadQuotes(false); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadQuotes(false); });
