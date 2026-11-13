// صرّاف 3.3 — منطق التطبيق: الأسعار، الذهب، التحويل، قديم⇄جديد، ترتيب العملات، الرسم البياني، المشاركة،
// الإشعارات (أوقات + تغيّر السعر + سعر محدد)، الويدجت، القائمة، البطاقة الطبية، التحديث من GitHub
import { buildRates } from './lib/rates.js';
import { normalizeDigits } from './lib/parser.js';
import { SOCIAL_ICONS } from './lib/social-icons.js';
import { amountToWords } from './lib/words.js';
import { lineChart } from './lib/chart.js';
import { drawShareImage } from './lib/share-image.js';

const CFG = window.APP_CONFIG;
const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const P = (name) => (isNative && Cap.Plugins ? Cap.Plugins[name] : null);
const RUNNER_LABEL = 'com.liraconverter.app.daily';
const RATIO = Number(CFG.OLD_PER_NEW) || 100; // 1 جديدة = RATIO قديمة
const WORKER_REFRESH = (CFG.REFRESH_SECONDS || 60) * 1000;          // مع الـ Worker
const DIRECT_REFRESH = (CFG.DIRECT_REFRESH_SECONDS || 300) * 1000;  // القراءة المباشرة (احتياط)
const DEV_TAPS = 7;

const LS = {
  rates: 'lira.rates', prev: 'lira.prevRates', prevG: 'lira.prevGold', okAt: 'lira.lastOkAt',
  src: 'lira.src', karat: 'lira.karat', mode: 'lira.mode', amount: 'lira.amount',
  api: 'lira.api', channels: 'lira.channels', resKarat: 'lira.resKarat',
  tab: 'sarraf.tab', goldCur: 'sarraf.goldCur', gcGrams: 'sarraf.gcGrams', gcKarat: 'sarraf.gcKarat', gcFee: 'sarraf.gcFee',
  onFlip: 'sarraf.onFlip', onOld: 'sarraf.onOld',
  launches: 'sarraf.launches', tipHiddenAt: 'sarraf.tipHiddenAt', notifyPrompted: 'sarraf.notifyPrompted',
  notify: 'sarraf.notify', alert: 'sarraf.alert', dev: 'sarraf.dev', hist: 'sarraf.history',
  chartWhat: 'sarraf.chartWhat', chartDays: 'sarraf.chartDays',
  remote: 'sarraf.remoteConfig', otaReady: 'sarraf.otaReadyBuild', otaPath: 'sarraf.otaPath',
  order: 'sarraf.order', gcDir: 'sarraf.gcDir', change: 'sarraf.change', updSkip: 'sarraf.updSkip',
};
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ================= تقليل الحركة =================
const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
let reduceMotion = !!(mq && mq.matches);
mq?.addEventListener?.('change', (e) => { reduceMotion = e.matches; document.documentElement.classList.toggle('reduce-motion', reduceMotion); });
document.documentElement.classList.toggle('reduce-motion', reduceMotion);

// ================= العملات والذهب =================
// rate = كم ليرة جديدة تساوي وحدة واحدة. flag = ملف SVG داخل التطبيق
const F = (c) => `img/flags/${c}.svg`;
const CURRENCIES = [
  { id: 'USD', name: 'دولار أمريكي', code: 'USD', flag: F('us'), fam: 'usd', dec: 2, rate: (r, m) => r.usd_syp?.[m] },
  { id: 'SYP', name: 'ليرة سورية جديدة', code: 'ل.س', flag: F('sy'), fam: 'syp', dec: 2, rate: () => 1 },
  { id: 'SYP_OLD', name: 'ليرة سورية قديمة', code: 'ل.س قديمة', flag: F('sy'), fam: 'syp', dec: 0, rate: () => 1 / RATIO },
  { id: 'TRY', name: 'ليرة تركية', code: 'TRY', flag: F('tr'), fam: 'try', dec: 2, rate: (r, m) => r.try_syp?.[m] },
  { id: 'EUR', name: 'يورو', code: 'EUR', flag: F('eu'), fam: 'eur', dec: 2, rate: (r, m) => r.eur_syp?.[m] },
  // عملات الحوالات: محسوبة من السعر العالمي × دولار السوق
  { id: 'SAR', name: 'ريال سعودي', code: 'SAR · محسوب', flag: F('sa'), fam: 'remit', dec: 2, remit: true, rate: (r, m) => r.remit?.sar_syp?.[m] },
  { id: 'AED', name: 'درهم إماراتي', code: 'AED · محسوب', flag: F('ae'), fam: 'remit', dec: 2, remit: true, rate: (r, m) => r.remit?.aed_syp?.[m] },
  { id: 'KWD', name: 'دينار كويتي', code: 'KWD · محسوب', flag: F('kw'), fam: 'remit', dec: 2, remit: true, rate: (r, m) => r.remit?.kwd_syp?.[m] },
  { id: 'JOD', name: 'دينار أردني', code: 'JOD · محسوب', flag: F('jo'), fam: 'remit', dec: 2, remit: true, rate: (r, m) => r.remit?.jod_syp?.[m] },
];
const GOLD_SRC = { id: 'GOLD', name: 'ذهب', flag: '🥇', fam: 'gold' };
const GOLD_ITEMS = [
  { k: '21', name: 'غرام عيار 21', unit: 'غرام', main: true },
  { k: '18', name: 'غرام عيار 18', unit: 'غرام' },
  { k: '24', name: 'غرام عيار 24', unit: 'غرام' },
  { k: 'lira', name: 'الليرة الذهب', sub: '8 غرام عيار 21', unit: 'ليرة' },
];
const GOLD_CURS = {
  USD: { sym: '$', dec: 2 }, TRY: { sym: '₺', dec: 0 }, SYP: { sym: 'ل.س', dec: 0 }, SYP_OLD: { sym: 'ل.س قديمة', dec: 0 },
};
const RATE_ROWS = [
  { key: 'usd_syp', name: 'الدولار', code: 'بالليرة الجديدة', flag: F('us'), fam: 'usd' },
  { key: 'eur_syp', name: 'اليورو', code: 'بالليرة الجديدة', flag: F('eu'), fam: 'eur' },
  { key: 'try_syp', name: 'الليرة التركية', code: 'بالليرة الجديدة', flag: F('tr'), fam: 'try' },
  { key: 'try_usd', name: 'الدولار', code: 'بالليرة التركية', flag: F('us'), fam: 'try' },
];
const REMIT_ROWS = [
  { key: 'sar_syp', name: 'الريال السعودي', flag: F('sa') },
  { key: 'aed_syp', name: 'الدرهم الإماراتي', flag: F('ae') },
  { key: 'kwd_syp', name: 'الدينار الكويتي', flag: F('kw') },
  { key: 'jod_syp', name: 'الدينار الأردني', flag: F('jo') },
];
const CITY_AR = { damascus: 'دمشق', aleppo: 'حلب', idlib: 'إدلب', homs: 'حمص', hama: 'حماة', latakia: 'اللاذقية', hasakah: 'الحسكة', qamishli: 'القامشلي', deir: 'دير الزور', daraa: 'درعا', sweida: 'السويداء', raqqa: 'الرقة', tartus: 'طرطوس' };
const flagHtml = (f) => (f && f.startsWith('img/') ? `<img src="${f}" alt="" decoding="async">` : f || '');

// ================= ترتيب العملات وإخفاؤها =================
// [{id, on}] لكل العملات + قسم الذهب. لازم تضل عملة وحدة مفعّلة على الأقل.
const ORDER_IDS = [...CURRENCIES.map((c) => c.id), 'GOLD'];
function getOrder() {
  const saved = store.get(LS.order) || [];
  const out = saved.filter((o) => ORDER_IDS.includes(o.id));
  for (const id of ORDER_IDS) if (!out.find((o) => o.id === id)) out.push({ id, on: true });
  return out;
}
const isOn = (id) => getOrder().find((o) => o.id === id)?.on !== false;
const enabledIds = () => getOrder().filter((o) => o.on).map((o) => o.id);
// مفتاح كل عملة بنتيجة الأسعار (للإشعار والويدجت والمشاركة)
const PRICE_KEY = { USD: 'usd_syp', TRY: 'try_syp', EUR: 'eur_syp', SAR: 'sar_syp', AED: 'aed_syp', KWD: 'kwd_syp', JOD: 'jod_syp' };
const SHORT_NAME = { USD: 'الدولار', TRY: 'التركي', EUR: 'اليورو', SAR: 'الريال السعودي', AED: 'الدرهم الإماراتي', KWD: 'الدينار الكويتي', JOD: 'الدينار الأردني' };
const priceOf = (r, id) => { const k = PRICE_KEY[id]; return k ? (r?.[k] || r?.remit?.[k] || null) : null; };
// عملات أجنبية مفعّلة بالترتيب (بدون الليرة السورية نفسها) — للمشاركة والإشعار والويدجت
const foreignEnabled = (r) => enabledIds().filter((id) => PRICE_KEY[id] && (!r || priceOf(r, id)));

// سعر وحدة الذهب بالليرة الجديدة: المحلي إن وُجد، وإلا (الدولار × سعر الدولار بالسوق)
function goldSyp(r, k, mode) {
  const g = r?.gold;
  if (!g) return null;
  if (k === 'ounce') return g.ounce_usd && r.usd_syp?.[mode] ? g.ounce_usd * r.usd_syp[mode] : null;
  if (g.syp?.[k]) return g.syp[k];
  const u = g.usd?.[k];
  return u && r.usd_syp?.[mode] ? u * r.usd_syp[mode] : null;
}
// تحويل قيمة بالليرة الجديدة إلى عملة عرض الذهب، بنفس وضع الشراء/المبيع
function sypTo(cur, syp, r, mode) {
  if (syp == null) return null;
  if (cur === 'SYP') return syp;
  if (cur === 'SYP_OLD') return syp * RATIO;
  if (cur === 'USD') return r.usd_syp?.[mode] ? syp / r.usd_syp[mode] : null;
  if (cur === 'TRY') return r.try_syp?.[mode] ? syp / r.try_syp[mode] : null;
  return null;
}
const goldIn = (r, k, cur, mode) => sypTo(cur, goldSyp(r, k, mode), r, mode);

const state = {
  rates: store.get(LS.rates),
  prev: store.get(LS.prev),
  prevG: store.get(LS.prevG),
  lastOkAt: store.get(LS.okAt),
  src: store.get(LS.src, 'USD'),
  karat: store.get(LS.karat, '21'),
  resKarat: store.get(LS.resKarat, '21'),
  mode: store.get(LS.mode, 'buy'),
  tab: store.get(LS.tab, 'convert'),
  goldCur: store.get(LS.goldCur, CFG.GOLD_DEFAULT_CURRENCY || 'SYP'),
  gcKarat: store.get(LS.gcKarat, '21'),
  gcDir: store.get(LS.gcDir, 'g2m'), // g2m: غرامات ← سعر | m2g: مبلغ ← غرامات
  onFlip: store.get(LS.onFlip, false), // false: القديم فوق (المُدخل) والجديد تحت
  chartWhat: store.get(LS.chartWhat, 'usd'),
  chartDays: store.get(LS.chartDays, 7),
  remoteHist: null,
  via: null,          // 'worker' | 'direct'
  suspect: null,      // سعر مرفوض بالفحص المنطقي
  online: true,
  loading: false,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (v, dec) => v == null || !isFinite(v) ? '—'
  : new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec }).format(v);
const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SY-u-nu-latn', { timeZone: 'Asia/Damascus', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  } catch { return new Date(iso).toLocaleString(); }
};
function plural(n, one, two, few) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
}
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'هلأ';
  if (m < 60) return 'من ' + plural(m, 'دقيقة', 'دقيقتين', 'دقايق');
  const h = Math.round(m / 60);
  if (h < 48) return 'من ' + plural(h, 'ساعة', 'ساعتين', 'ساعات');
  return 'من ' + plural(Math.round(h / 24), 'يوم', 'يومين', 'أيام');
};
const parseAmount = (s) => { const v = parseFloat(normalizeDigits(String(s)).replace(/[,\s]/g, '')); return Number.isFinite(v) ? v : 0; };

// ================= عدّاد الأرقام (count-up) =================
const shown = new Map(); // آخر قيمة معروضة لكل مفتاح
function setNum(el, key, value, dec, animate) {
  if (!el) return;
  const prev = shown.get(key);
  shown.set(key, value);
  const txt = (v) => fmtNum(v, dec);
  if (el._raf) cancelAnimationFrame(el._raf);
  clearTimeout(el._end);
  if (!animate || reduceMotion || prev == null || value == null || !isFinite(prev) || prev === value) { el.textContent = txt(value); return; }
  const t0 = performance.now(), D = 320;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3);
    el.textContent = txt(prev + (value - prev) * e);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
  // ضمان القيمة النهائية حتى لو توقفت الإطارات (التطبيق بالخلفية)
  el._end = setTimeout(() => { cancelAnimationFrame(el._raf); el.textContent = txt(value); }, D + 40);
}
function fillNums(root, animate) {
  root.querySelectorAll('[data-k]').forEach((el) => {
    const v = el.dataset.v === '' ? null : Number(el.dataset.v);
    setNum(el, el.dataset.k, v, Number(el.dataset.dec || 2), animate);
  });
}
const numSpan = (key, v, dec, cls = '') => `<span class="${cls}" data-k="${key}" data-v="${v == null || !isFinite(v) ? '' : v}" data-dec="${dec}">${fmtNum(shown.has(key) ? shown.get(key) : v, dec)}</span>`;

// ================= لمس: اهتزاز خفيف =================
let lastHaptic = 0;
function haptic() {
  const H = P('Haptics');
  if (!H || Date.now() - lastHaptic < 60) return;
  lastHaptic = Date.now();
  H.impact({ style: 'LIGHT' }).catch(() => {});
}
function toast(msg, ms = 1800) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms);
}

// فتح الروابط بالتطبيق الخاص إن كان مثبتاً، وإلا بالمتصفح
async function openExternal(url) {
  if (!url) return;
  const L = P('AppLauncher');
  if (L) { try { await L.openUrl({ url }); return; } catch (e) { console.warn(e); } }
  window.open(url, '_blank', 'noopener');
}

// ================= جلب الأسعار =================
// الـ Worker أولاً. إذا ردّ، ما منسحب تلغرام مباشرة أبداً.
// القراءة المباشرة احتياط فقط (Worker مو مضبوط أو ما عم يرد)، وبتصير كل 5 دقايق بدل كل دقيقة.
function apiUrl() { return (store.get(LS.api) ?? CFG.API_URL ?? '').trim(); }
// القنوات: اختيار المطوّر من الإعدادات المخفية، وإلا الإعدادات عن بعد (/update)، وإلا config.js
function channels() {
  const c = store.get(LS.channels);
  if (c && c.length) return c;
  const r = store.get(LS.remote);
  return r && Array.isArray(r.channels) && r.channels.length ? r.channels : CFG.CHANNELS;
}
function workerPath(path) {
  const a = apiUrl();
  if (!a) return '';
  try { const u = new URL(a); u.pathname = path; u.search = ''; return u.toString(); } catch { return ''; }
}
function contentUrl() { return CFG.TIPS_URL || CFG.CONTENT_URL || workerPath('/content'); }
async function fetchWithTimeout(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(t); }
}
class SuspectError extends Error { constructor(msg, rejected, fromWorker) { super(msg); this.rejected = rejected; this.fromWorker = fromWorker; } }
async function fetchFromWorker(url) {
  const res = await fetchWithTimeout(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now());
  let d = null;
  try { d = await res.json(); } catch { throw new Error('worker bad json ' + res.status); }
  if (d && d.rejected && !d.usd_syp) throw new SuspectError(d.error, d.rejected, true); // الـ Worker شغال بس السعر مشبوه
  if (!res.ok || !d.usd_syp) throw new Error('worker ' + res.status);
  return d;
}
async function fetchDirect() {
  const page = async (ch) => (await fetchWithTimeout(`https://t.me/s/${ch}`)).text();
  const fx = async () => (await (await fetchWithTimeout('https://open.er-api.com/v6/latest/USD')).json()).rates;
  const ounce = async () => (await (await fetchWithTimeout(CFG.GOLD_API)).json()).price;
  const last = state.rates?.usd_syp ? { usd_syp: state.rates.usd_syp } : null;
  const d = await buildRates(channels(), page, fx, { fetchGoldOunce: ounce, GOLD_CHANNELS: CFG.GOLD_CHANNELS || '', last });
  if (d.error) { if (d.rejected) throw new SuspectError(d.error, d.rejected, false); throw new Error(d.error); }
  return d;
}
const sameRates = (a, b) => a && b && RATE_ROWS.every(({ key }) => a[key]?.buy === b[key]?.buy && a[key]?.sell === b[key]?.sell);
const goldSig = (r) => JSON.stringify([r?.gold?.usd, r?.gold?.syp, r?.usd_syp]);

let firstPaint = true, timer = null, lastAttemptAt = 0, lastDirectAt = 0;
const nextDelay = () => (state.via === 'worker' ? WORKER_REFRESH : DIRECT_REFRESH);
function scheduleNext() { clearTimeout(timer); timer = setTimeout(() => refresh(), nextDelay()); }

async function refresh({ manual = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  lastAttemptAt = Date.now();
  $('ptr').classList.add('loading');
  let data = null, changed = false;
  try {
    const api = apiUrl();
    let workerAlive = false;
    if (api) {
      try { data = await fetchFromWorker(api); state.via = 'worker'; }
      catch (e) { if (e instanceof SuspectError) { workerAlive = true; throw e; } console.warn('worker failed', e); }
    }
    if (!data && !workerAlive) {
      // احتياط: قراءة مباشرة بحد أقصى مرة كل 5 دقايق (إلا إذا ضغط المستخدم تحديث أو ما في أسعار أبداً)
      if (!manual && state.rates && Date.now() - lastDirectAt < DIRECT_REFRESH - 5000) { state.via = 'direct'; return; }
      lastDirectAt = Date.now();
      state.via = 'direct';
      data = await fetchDirect();
    }
    if (state.rates && !sameRates(state.rates, data)) {
      state.prev = state.rates; store.set(LS.prev, state.prev); changed = true;
    }
    if (state.rates?.gold && data.gold && goldSig(state.rates) !== goldSig(data)) {
      state.prevG = state.rates; store.set(LS.prevG, state.prevG); changed = true;
    }
    if (!data.gold && state.rates?.gold) data.gold = state.rates.gold;
    state.rates = data;
    state.suspect = null;
    state.lastOkAt = new Date().toISOString();
    state.online = true;
    store.set(LS.rates, data);
    store.set(LS.okAt, state.lastOkAt);
    recordHistory(data);
    afterNewRates(data);
  } catch (e) {
    console.warn('refresh failed', e);
    if (e instanceof SuspectError) { state.suspect = e.rejected; state.online = true; }
    else state.online = false;
  } finally {
    state.loading = false;
    $('ptr').classList.remove('loading', 'pull');
    $('ptr').style.transform = '';
    render(!firstPaint);
    if (changed) flashChanged();
    firstPaint = false;
    scheduleNext();
  }
}

// بعد كل سعر جديد: الويدجت + نص الإشعار الصباحي (الأصلي)
function afterNewRates(r) {
  const N = P('SarrafNative');
  if (!N) return;
  const m = state.mode, prevUsd = state.prev?.usd_syp?.[m];
  const rows = foreignEnabled(r).slice(0, 3).map((id) => ({ key: PRICE_KEY[id], label: SHORT_NAME[id], value: priceOf(r, id)?.[m] ?? NaN }));
  N.updateWidget({
    rows, mode: m, usd: r.usd_syp[m], usdDir: prevUsd ? Math.sign(r.usd_syp[m] - prevUsd) : 0,
    g21: goldSyp(r, '21', m) ?? NaN, goldOn: goldOn(), at: Date.now(),
  }).catch(() => {});
  if (notifySettings().enabled) N.setMorning({ body: morningText(r) }).catch(() => {});
}

// ================= السجل (للرسم البياني) =================
// السجل الكامل من الـ Worker (/history). بدونه: سجل محلي من الأسعار اللي جابها التطبيق (نقطة بالساعة)
function histPoint(r, t = new Date().toISOString()) {
  const g21u = r.gold?.usd?.['21'] ?? null;
  return { t, usd_buy: r.usd_syp.buy, usd_sell: r.usd_syp.sell, g21_usd: g21u, g21_syp: r.gold?.syp?.['21'] ?? (g21u ? g21u * r.usd_syp.sell : null) };
}
function recordHistory(r) {
  const h = store.get(LS.hist, []);
  const p = histPoint(r);
  const cutoff = Date.now() - 30 * 86400e3;
  const keep = h.filter((x) => Date.parse(x.t) >= cutoff);
  if (keep.length && keep[keep.length - 1].t.slice(0, 13) === p.t.slice(0, 13)) keep[keep.length - 1] = p;
  else keep.push(p);
  store.set(LS.hist, keep);
}
async function loadRemoteHistory() {
  const url = workerPath('/history');
  if (!url) return;
  try {
    const d = await (await fetchWithTimeout(url + '?days=30', 10000)).json();
    if (Array.isArray(d.points)) { state.remoteHist = d.points; renderChart(); }
  } catch { /* نكمل بالسجل المحلي */ }
}

// ================= العرض =================
const dirClass = (cur, prev) => (cur == null || prev == null || Math.abs(cur - prev) < 1e-9 ? '' : cur > prev ? 'up' : 'down');
const arrowHtml = (c) => (c === 'up' ? '<span class="arrow">▲</span> ' : c === 'down' ? '<span class="arrow">▼</span> ' : '');

function renderTabs() {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  $('panel-convert').hidden = state.tab !== 'convert';
  $('panel-oldnew').hidden = state.tab !== 'oldnew';
}

// العملات المفعّلة بترتيب المستخدم (وعملات الحوالات بس إذا سعرها متوفر)
const availableCurrencies = () => getOrder().filter((o) => o.on && o.id !== 'GOLD')
  .map((o) => CURRENCIES.find((c) => c.id === o.id))
  .filter((c) => c && (!c.remit || (state.rates && c.rate(state.rates, state.mode))));
const goldOn = () => isOn('GOLD');

function renderChips() {
  const list = [...availableCurrencies(), ...(goldOn() ? [GOLD_SRC] : [])];
  if (list.length && !list.find((c) => c.id === state.src)) { state.src = list[0].id; store.set(LS.src, state.src); }
  $('srcChips').innerHTML = list.map((c) =>
    `<button class="chip press fam-${c.fam}" role="radio" data-id="${c.id}" aria-checked="${c.id === state.src}"><span class="dot">${flagHtml(c.flag)}</span>${c.name}</button>`).join('');
  const kp = $('karatPick');
  kp.hidden = state.src !== 'GOLD';
  kp.innerHTML = GOLD_ITEMS.map((g) => `<button class="press" role="radio" data-k="${g.k}" aria-checked="${g.k === state.karat}">${g.k === 'lira' ? 'ليرة ذهب' : 'عيار ' + g.k}</button>`).join('');
  const u = state.src === 'GOLD' ? GOLD_ITEMS.find((g) => g.k === state.karat) : null;
  $('amountLbl').textContent = u ? (u.unit === 'ليرة' ? 'عدد الليرات الذهب' : `عدد الغرامات (عيار ${u.k})`) : 'المبلغ';
  document.querySelectorAll('.mode [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
}

function srcRate(r) {
  if (state.src === 'GOLD') return goldSyp(r, state.karat, state.mode);
  return CURRENCIES.find((c) => c.id === state.src)?.rate(r, state.mode);
}

function renderResults(animate) {
  const r = state.rates, box = $('results');
  if (!r) { box.innerHTML = `<div class="row"><span class="muted">عم نجيب الأسعار لأول مرة… لازم يكون في نت.</span></div>`; return; }
  const amount = parseAmount($('amount').value), sr = srcRate(r);
  const rows = availableCurrencies().filter((c) => c.id !== state.src).map((c) => {
    const tr = c.rate(r, state.mode), v = sr && tr ? (amount * sr) / tr : null;
    return `<div class="row fam-${c.fam}" data-row="${c.id}">
      <span class="flag">${flagHtml(c.flag)}</span>
      <div class="meta"><div class="name">${c.name}</div><div class="code">${c.code}</div></div>
      ${numSpan('res-' + c.id, v, c.dec, 'val' + (c.remit ? ' sm' : ''))}
    </div>`;
  });
  if (state.src !== 'GOLD' && r.gold && goldOn()) {
    // بالعكس: كم غرام/ليرة ذهب يساوي المبلغ
    const gr = goldSyp(r, state.resKarat, state.mode), v = sr && gr ? (amount * sr) / gr : null;
    const item = GOLD_ITEMS.find((g) => g.k === state.resKarat) || GOLD_ITEMS[0];
    const opts = GOLD_ITEMS.map((g) => `<option value="${g.k}" ${g.k === state.resKarat ? 'selected' : ''}>${g.k === 'lira' ? 'ليرة ذهب' : 'عيار ' + g.k}</option>`).join('');
    rows.push(`<div class="row fam-gold" data-row="GOLD">
      <span class="flag">🥇</span>
      <div class="meta"><div class="name">ذهب <select id="resKarat" aria-label="العيار">${opts}</select></div>
      <div class="code">${item.unit === 'ليرة' ? 'ليرة ذهب' : 'غرام'}${r.gold.estimated ? ' · تقديري' : ''}</div></div>
      ${numSpan('res-GOLD', v, 3, 'val')}
    </div>`);
  }
  box.innerHTML = rows.join('');
  fillNums(box, animate);
}

const pairHtml = (key, cur, old) => {
  const cb = dirClass(cur?.buy, old?.buy), cs = dirClass(cur?.sell, old?.sell);
  return `<div class="pair"><span class="b ${cb}">${arrowHtml(cb)}${numSpan('rate-' + key + '-b', cur?.buy, 2)}</span><span class="sep">·</span><span class="s ${cs}">${arrowHtml(cs)}${numSpan('rate-' + key + '-s', cur?.sell, 2)}</span></div>`;
};

function renderRates(animate) {
  const r = state.rates, p = state.prev;
  if (!r) { $('ratesList').innerHTML = ''; $('remitBox').hidden = true; $('disagreeNote').hidden = true; return; }
  // صفوف الأسعار بترتيب المستخدم: الدولار ← usd_syp، اليورو ← eur_syp، التركي ← try_syp و try_usd
  const ROW_OF = { USD: ['usd_syp'], EUR: ['eur_syp'], TRY: ['try_syp', 'try_usd'] };
  const keys = enabledIds().flatMap((id) => ROW_OF[id] || []).filter((k) => k !== 'try_usd' || isOn('USD'));
  const rows = keys.map((k) => RATE_ROWS.find((x) => x.key === k)).filter(Boolean);
  $('ratesList').innerHTML = rows.map(({ key, name, code, flag, fam }) => {
    const tag = r.derived?.includes(key) ? ' <span class="tag">محسوب</span>' : '';
    return `<div class="row fam-${fam}" data-row="${key}">
      <span class="flag">${flagHtml(flag)}</span>
      <div class="meta"><div class="name">${name}${tag}</div><div class="code">${code}</div></div>
      ${pairHtml(key, r[key], p?.[key])}
    </div>`;
  }).join('');
  fillNums($('ratesList'), animate);

  // عملات الحوالات
  const REMIT_ID = { sar_syp: 'SAR', aed_syp: 'AED', kwd_syp: 'KWD', jod_syp: 'JOD' };
  const rem = enabledIds().map((id) => REMIT_ROWS.find((x) => REMIT_ID[x.key] === id)).filter((x) => x && r.remit?.[x.key]);
  $('remitBox').hidden = !rem.length;
  $('remitList').innerHTML = rem.map(({ key, name, flag }) => `<div class="row fam-remit" data-row="${key}">
      <span class="flag">${flagHtml(flag)}</span>
      <div class="meta"><div class="name">${name}</div><div class="code">بالليرة الجديدة</div></div>
      ${pairHtml(key, r.remit[key], p?.remit?.[key])}
    </div>`).join('');
  fillNums($('remitList'), animate);

  // المصادر مختلفة (> 2%)
  const dn = $('disagreeNote');
  if (r.disagree?.values?.length > 1) {
    dn.innerHTML = `⚠️ <b>المصادر مختلفة</b>: ` + r.disagree.values.map((v) =>
      `${esc(v.channel)} <span class="pair-mini">${fmtNum(v.usd_syp.buy, 2)} / ${fmtNum(v.usd_syp.sell, 2)}</span>`).join(' · ');
    dn.hidden = false;
  } else dn.hidden = true;

  $('timesShort').textContent = r.post_time ? `آخر نشرة ${ago(r.post_time)} · تحديث ${state.lastOkAt ? ago(state.lastOkAt) : '—'}` : '—';
  $('postTime').textContent = r.post_time ? `${fmtTime(r.post_time)} (${ago(r.post_time)})` : '—';
  $('fetchTime').textContent = state.lastOkAt ? `${fmtTime(state.lastOkAt)} (${ago(state.lastOkAt)})` : '—';
  const bits = [];
  if (r.source) bits.push(`المصدر: t.me/${r.source}`);
  if (r.city) bits.push(CITY_AR[r.city] || r.city);
  if (r.confirmed_by) bits.push(`مؤكد من ${r.confirmed_by}`);
  bits.push(state.via === 'worker' ? 'عبر خادم صرّاف' : 'قراءة مباشرة');
  $('sourceLine').textContent = bits.join(' · ');
}

function renderGold(animate) {
  const r = state.rates, g = r?.gold, card = $('goldCard');
  card.hidden = !g || !goldOn();
  if (!g) return;
  $('goldEst').hidden = !g.estimated;
  document.querySelectorAll('#goldCur [data-cur]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cur === state.goldCur)));
  const cur = state.goldCur, cfg = GOLD_CURS[cur], pg = state.prevG, m = state.mode;
  const dec = (v) => (cur === 'TRY' && v != null && v < 1000 ? 2 : cfg.dec);
  const items = [...GOLD_ITEMS, ...(g.ounce_usd ? [{ k: 'ounce', name: 'الأونصة العالمية', sub: '31.1 غرام عيار 24' }] : [])];
  $('goldList').innerHTML = items.map((it) => {
    const v = goldIn(r, it.k, cur, m), c = dirClass(v, pg ? goldIn(pg, it.k, cur, m) : null);
    return `<div class="g-row ${it.main ? 'main' : ''}">
      <div><div class="g-name">${it.name}</div>${it.sub ? `<div class="g-sub">${it.sub}</div>` : ''}</div>
      <div class="g-val ${c}">${arrowHtml(c)}${cur === 'USD' ? '$' : ''}${numSpan(`gold-${it.k}`, v, dec(v))}${cur !== 'USD' ? `<span class="sym">${cfg.sym}</span>` : ''}</div>
    </div>`;
  }).join('');
  fillNums($('goldList'), animate);
  renderGoldCalc(animate);
  const t = g.post_time || r.fetched;
  $('goldTime').textContent = t ? `${fmtTime(t)} (${ago(t)})` : '—';
}

// حاسبة الذهب: (سعر الغرام + أجرة الصياغة للغرام) × عدد الغرامات
function renderGoldCalc(animate) {
  const r = state.rates;
  if (!r?.gold) return;
  $('gcKarat').innerHTML = ['21', '18', '24'].map((k) => `<button class="press" role="radio" data-k="${k}" aria-checked="${k === state.gcKarat}">عيار ${k}</button>`).join('');
  document.querySelectorAll('#gcDir [data-dir]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.dir === state.gcDir)));
  const input = parseAmount($('gcGrams').value);
  const fee = parseAmount($('gcFee').value);
  const cur = state.goldCur, cfg = GOLD_CURS[cur];
  const price = goldIn(r, state.gcKarat, cur, state.mode);
  const dec = cur === 'USD' ? 2 : cfg.dec;
  const br = $('gcBreak');
  $('gcFeeSym').textContent = cfg.sym;
  if (state.gcDir === 'm2g') {
    // مبلغ → كم غرام بيجيب (مع الصياغة إذا مكتوبة)
    const grams = price ? input / (price + fee) : NaN;
    $('gcGrams').setAttribute('aria-label', 'المبلغ');
    $('gcUnit').textContent = `${cur === 'USD' ? '$' : ''}${fmtNum(input, dec)}${cur !== 'USD' ? ' ' + cfg.sym : ''} بتجيب عيار ${state.gcKarat} =`;
    setNum($('gcResult'), 'gc', isFinite(grams) ? grams : null, 3, animate);
    $('gcSym').textContent = 'غرام';
    br.hidden = !(fee > 0 && isFinite(grams));
    if (!br.hidden) br.textContent = `على سعر ${fmtNum(price, dec)} + صياغة ${fmtNum(fee, dec)} ${cfg.sym} للغرام`;
    return;
  }
  const grams = input;
  const gold = grams * (price ?? NaN), fees = grams * fee;
  const v = gold + fees;
  $('gcGrams').setAttribute('aria-label', 'عدد الغرامات');
  $('gcUnit').textContent = `${fmtNum(grams, 3)} غرام عيار ${state.gcKarat} =`;
  setNum($('gcResult'), 'gc', isFinite(v) ? v : null, dec, animate);
  $('gcSym').textContent = cfg.sym;
  br.hidden = !(fee > 0 && isFinite(gold));
  if (!br.hidden) br.textContent = `ذهب ${fmtNum(gold, dec)} + صياغة ${fmtNum(fees, dec)} ${cfg.sym}`;
}

// ================= الرسم البياني =================
function chartSeries() {
  const remote = state.remoteHist && state.remoteHist.length >= 2;
  const src = remote ? state.remoteHist : store.get(LS.hist, []);
  const since = Date.now() - state.chartDays * 86400e3;
  const pts = src.filter((p) => Date.parse(p.t) >= since).map((p) => ({
    t: Date.parse(p.t),
    v: state.chartWhat === 'usd' ? (state.mode === 'sell' ? p.usd_sell : p.usd_buy) : (p.g21_syp ?? (p.g21_usd && p.usd_sell ? p.g21_usd * p.usd_sell : null)),
  }));
  return { pts, remote };
}
function renderChart() {
  document.querySelectorAll('#chartWhat [data-what]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.what === state.chartWhat)));
  document.querySelectorAll('#chartRange [data-days]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.days === state.chartDays)));
  const { pts, remote } = chartSeries();
  const isUsd = state.chartWhat === 'usd';
  const svg = lineChart(pts, { color: isUsd ? '#3B82F6' : '#F5C542', dec: isUsd ? 2 : 0, id: state.chartWhat });
  const box = $('chart'), chg = $('chartChange');
  // بدون بيانات كفاية البطاقة كلها مخفية (ما منعرض بطاقة فاضية ما إلها عمل)
  $('chartCard').hidden = !svg;
  if (!svg) {
    box.innerHTML = '';
    chg.textContent = '';
  } else {
    box.innerHTML = svg;
    const a = pts.find((p) => p.v != null)?.v, b = [...pts].reverse().find((p) => p.v != null)?.v;
    const pct = a ? ((b - a) / a) * 100 : 0;
    chg.className = 'chg ' + (pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : '');
    chg.textContent = `${pct > 0 ? '▲' : pct < 0 ? '▼' : ''} ${Math.abs(pct).toFixed(2)}%`;
  }
  const what = isUsd ? `الدولار (${state.mode === 'sell' ? 'مبيع' : 'شراء'}) بالليرة الجديدة` : 'غرام عيار 21 بالليرة الجديدة';
  $('chartNote').textContent = `${what} · ` + (remote ? 'من خادم صرّاف، لقطة كل ساعة' : 'من الأسعار اللي جابها التطبيق على هالجهاز');
}

function renderStatus() {
  const b = $('staleBanner'), live = $('livePill');
  const okAge = state.lastOkAt ? (Date.now() - new Date(state.lastOkAt)) / 60000 : Infinity;
  const staleLimit = Math.max(CFG.STALE_MINUTES, (nextDelay() / 60000) * 2);
  let msg = '';
  if (state.suspect) {
    const s = state.suspect[0];
    msg = `⚠️ القناة نشرت سعر بعيد كتير عن آخر سعر (${fmtNum(s.usd_syp.buy, 2)} / ${fmtNum(s.usd_syp.sell, 2)}). عم ننطر تأكيد، ومعروض آخر سعر موثوق.`;
  } else if (!state.online && state.rates) msg = `⚠️ ما في اتصال — معروضة آخر أسعار محفوظة (${ago(state.lastOkAt)}). ممكن تكون قديمة.`;
  else if (!state.online) msg = '⚠️ ما في اتصال بالإنترنت ولا في أسعار محفوظة لسا.';
  else if (okAge > staleLimit) msg = `⚠️ الأسعار ما تحدّثت ${ago(state.lastOkAt)} — ممكن تكون قديمة.`;
  else if (state.rates?.post_time && (Date.now() - new Date(state.rates.post_time)) > 24 * 3600e3)
    msg = `⚠️ آخر نشرة بالقناة ${ago(state.rates.post_time)} — السعر ممكن ما يعكس السوق هلأ.`;
  b.hidden = !msg;
  b.textContent = msg;
  const isLive = state.online && okAge <= staleLimit;
  live.classList.toggle('off', !isLive);
  live.querySelector('span').textContent = isLive ? 'مباشر' : 'مو متصل';
}

function render(animate = false) { renderTabs(); renderChips(); renderResults(animate); renderRates(animate); renderGold(animate); renderChart(); renderStatus(); }

// وميض الصف الذي تغيّر سعره (أخضر للارتفاع، أحمر للانخفاض)
function flashChanged() {
  if (reduceMotion) return;
  const r = state.rates, p = state.prev;
  for (const { key } of RATE_ROWS) {
    const d = dirClass(r?.[key]?.sell, p?.[key]?.sell);
    const row = document.querySelector(`#ratesList [data-row="${key}"]`);
    if (d && row) { row.classList.remove('flash-up', 'flash-down'); void row.offsetWidth; row.classList.add('flash-' + d); }
  }
  const gd = dirClass(goldSyp(r, '21', 'sell'), goldSyp(state.prevG, '21', 'sell'));
  const gm = document.querySelector('#goldList .g-row.main');
  if (gd && gm) { gm.classList.add('flash-' + gd); }
}

// ================= شارك السعر =================
function damascusDateLine() {
  try {
    return new Intl.DateTimeFormat('ar-SY-u-nu-latn', { timeZone: 'Asia/Damascus', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date());
  } catch { return new Date().toLocaleString(); }
}
// رابط التحميل الثابت (<الـ Worker>/get) وحساب إنستغرام — بينكتبوا على الصورة نفسها،
// لأن إنستغرام وفيسبوك بياخدوا الصورة وبيتجاهلوا أي نص مرفق معها (سياستهم، مو خلل بالتطبيق)
function downloadLink() { return CFG.DOWNLOAD_URL || workerPath('/get'); }
function shareHandle() {
  if (CFG.SHARE_HANDLE) return CFG.SHARE_HANDLE;
  const ig = (CFG.SOCIAL || []).find((s) => s.platform === 'instagram' && s.url);
  const m = ig && ig.url.match(/instagram\.com\/([^/?#]+)/);
  return m ? '@' + m[1] : '';
}
const shortLink = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
// النص اللي بينبعت مع الصورة (حسب ملف الإعدادات)
function shareCaption() {
  const lines = ['أسعار اليوم من تطبيق صرّاف 📲'];
  const link = downloadLink();
  if (link) lines.push(`حمّله ببلاش: ${link}`);
  const ig = CFG.SHARE_INSTAGRAM_URL || (CFG.SOCIAL || []).find((s) => s.platform === 'instagram')?.url;
  if (ig) lines.push(`تابعني: ${ig}`);
  return lines.join('\n');
}
export async function buildShareCanvas(format = 'post') {
  const r = state.rates, m = state.mode;
  const g21 = goldSyp(r, '21', m);
  // الأسعار المفعّلة بس وبترتيب المستخدم (لحد 4 عملات + الذهب)
  const FAM_COLOR = { usd: '#3B82F6', try: '#EF4444', eur: '#8B5CF6', remit: '#14B8A6', syp: '#1DB954' };
  const rows = foreignEnabled(r).slice(0, 4).map((id) => {
    const c = CURRENCIES.find((x) => x.id === id), p = priceOf(r, id);
    return { label: c.name, flag: c.flag, color: FAM_COLOR[c.fam], main: `${fmtNum(p.buy, 2)} / ${fmtNum(p.sell, 2)}`, sub: 'شراء / مبيع · ليرة جديدة' };
  });
  if (goldOn() && g21) rows.push({ label: 'غرام ذهب عيار 21', flag: null, color: '#F5C542', mainColor: '#F5C542', main: fmtNum(g21, 0), sub: `ليرة جديدة · ${fmtNum(g21 * RATIO, 0)} قديمة${r.gold?.estimated ? ' · تقديري' : ''}` });
  return drawShareImage({
    rows, format, dateLine: damascusDateLine(), author: (CFG.DEVELOPER || {}).name || '',
    handle: shareHandle(), link: shortLink(downloadLink()), note: 'الأسعار تقريبية من السوق الموازية',
  });
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok;
  }
}
// format: 'post' (4:5 منشور فيسبوك/إنستغرام) | 'story' (9:16 ستوري/حالة واتساب) | 'text' (نص بس)
async function shareRates(format) {
  closeShareSheet();
  const r = state.rates;
  if (!r) { toast('لسا ما في أسعار للمشاركة'); return; }
  const caption = shareCaption();
  const SH = P('Share'), FS = P('Filesystem');
  try {
    if (format === 'text') {
      if (SH) await SH.share({ title: 'أسعار اليوم – صرّاف', text: caption, dialogTitle: 'شارك السعر' });
      else if (navigator.share) await navigator.share({ text: caption });
      else { await copyText(caption); toast('تم نسخ النص'); }
      return;
    }
    const cv = await buildShareCanvas(format);
    const dataUrl = cv.toDataURL('image/png');
    // إنستغرام وفيسبوك ما بياخدوا النص المرفق، فمننسخه مشان المستخدم يلصقه بالمنشور
    const copied = await copyText(caption);
    if (copied) toast('النص منسوخ — الصقه مع الصورة', 2600);
    if (FS && SH) {
      const f = await FS.writeFile({ path: `sarraf-${format}-${Date.now()}.png`, data: dataUrl.split(',')[1], directory: 'CACHE' });
      await SH.share({ title: 'أسعار اليوم – صرّاف', text: caption, files: [f.uri], dialogTitle: 'شارك السعر' });
      return;
    }
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `sarraf-${format}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: caption }); return; }
    const a = document.createElement('a');
    a.href = dataUrl; a.download = `sarraf-${format}.png`; a.click();
    toast('تم حفظ الصورة');
  } catch (e) {
    if (!/cancel/i.test(String(e?.message || e))) { console.warn('share', e); toast('ما زبطت المشاركة'); }
  }
}
function openShareSheet() {
  if (!state.rates) { toast('لسا ما في أسعار للمشاركة'); return; }
  const bd = $('shareBackdrop'), sh = $('shareSheet');
  bd.hidden = false; sh.hidden = false;
  void sh.offsetWidth;
  bd.classList.add('show'); sh.classList.add('open');
}
function closeShareSheet() {
  const bd = $('shareBackdrop'), sh = $('shareSheet');
  if (sh.hidden) return;
  bd.classList.remove('show'); sh.classList.remove('open');
  setTimeout(() => { bd.hidden = true; sh.hidden = true; }, reduceMotion ? 0 : 250);
}

// ================= تحديث الـ APK من GitHub (version.json) =================
// version.json: { versionCode, versionName, apkUrl, notes }
let apkChecking = false, apkInfo = null;
async function myVersionCode() {
  try { return (await P('SarrafNative').otaInfo()).versionCode || 0; } catch { return 0; }
}
async function checkApkUpdate(manual = false) {
  if (!CFG.VERSION_URL || apkChecking) return;
  if (!isNative) { if (manual) toast('فحص التحديثات بيشتغل جوا التطبيق'); return; }
  apkChecking = true;
  try {
    const v = await (await fetchWithTimeout(CFG.VERSION_URL + '?t=' + Date.now(), 10000)).json();
    const mine = await myVersionCode();
    if (!v || !(v.versionCode > mine) || !v.apkUrl) { if (manual) toast('عندك آخر نسخة ✓'); return; }
    if (!manual && store.get(LS.updSkip) === v.versionCode) return; // "لاحقاً": منرجع نذكّره بالفتح الجاي بس إذا فحص يدوي
    apkInfo = v;
    openUpdModal(v);
  } catch (e) {
    if (manual) toast('ما قدرنا نفحص التحديثات — تأكد من النت');
  } finally { apkChecking = false; }
}
function openUpdModal(v) {
  $('updVer').textContent = v.versionName || '';
  $('updNotes').textContent = v.notes || 'تحسينات وإصلاحات.';
  $('updProgress').hidden = true;
  $('updMsg').textContent = '';
  $('updGo').disabled = false;
  $('updGo').textContent = 'حدّث الآن';
  const bd = $('updBackdrop'), sh = $('updModal');
  bd.hidden = false; sh.hidden = false;
  void sh.offsetWidth;
  bd.classList.add('show'); sh.classList.add('open');
}
function closeUpdModal() {
  const bd = $('updBackdrop'), sh = $('updModal');
  if (sh.hidden) return;
  bd.classList.remove('show'); sh.classList.remove('open');
  setTimeout(() => { bd.hidden = true; sh.hidden = true; }, reduceMotion ? 0 : 250);
}
let apkReady = false, waitingInstallPerm = false;
async function installDownloaded() {
  const N = P('SarrafNative');
  const r = await N.installApk();
  if (r.needPermission) {
    waitingInstallPerm = true;
    $('updMsg').textContent = 'لازم تسمح لصرّاف يثبّت التحديث: بالصفحة اللي رح تنفتح فعّل "السماح من هالمصدر"، وارجع للتطبيق، والتثبيت بيكمّل لحاله.';
    $('updGo').textContent = 'افتح الإعدادات';
    $('updGo').disabled = false;
    $('updGo').onclick = () => N.openInstallSettings();
  }
}
async function startApkUpdate() {
  const N = P('SarrafNative');
  if (!N || !apkInfo) return;
  if (apkReady) { installDownloaded(); return; }
  $('updGo').disabled = true;
  $('updProgress').hidden = false;
  $('updMsg').textContent = 'عم ننزّل التحديث…';
  const sub = await N.addListener('apkProgress', (p) => {
    const pct = p.pct >= 0 ? p.pct : null;
    $('updBar').style.width = (pct ?? 50) + '%';
    $('updPct').textContent = pct != null ? pct + '%' : (p.bytes / 1048576).toFixed(1) + ' MB';
  });
  try {
    await N.downloadApk({ url: apkInfo.apkUrl });
    apkReady = true;
    $('updMsg').textContent = 'نزل التحديث ✓';
    await installDownloaded();
  } catch (e) {
    $('updMsg').textContent = 'ما زبط التنزيل (' + (e?.message || 'تأكد من النت') + '). التطبيق بيكمّل شغل عادي، وبتقدر تجرّب بعدين.';
    $('updGo').disabled = false;
    $('updGo').textContent = 'جرّب مرة تانية';
  } finally { sub?.remove?.(); }
}

// ================= تحديث هوائي للواجهة عبر الـ Worker (اختياري) =================
// /update على الـ Worker: { apk:{versionCode,versionName,url,notes,force}, web:{build,minNative,url,sha256}, config:{channels} }
function updateUrl() { return CFG.UPDATE_URL || workerPath('/update'); }
let updateChecking = false;
async function checkUpdates() {
  const url = updateUrl();
  if (!url || updateChecking) return;
  updateChecking = true;
  try {
    const u = await (await fetchWithTimeout(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), 10000)).json();
    if (u.config) store.set(LS.remote, u.config); // إعدادات عن بعد (القنوات) بدون تحديث التطبيق
    const N = P('SarrafNative');
    if (!N) return;
    const info = await N.otaInfo();
    let bad = [];
    try { bad = JSON.parse(info.bad || '[]'); } catch {}
    // تحديثات الـ APK صارت من GitHub (version.json)، هون بس تحديث الواجهة الهوائي
    const w = u.web;
    const myBuild = Number(CFG.WEB_BUILD) || 1;
    if (w && w.build > myBuild && w.sha256 && w.url && info.versionCode >= (w.minNative || 0) && !bad.includes(w.build)) {
      if (store.get(LS.otaReady) === w.build) { showUpdateBar({ kind: 'web', build: w.build, path: store.get(LS.otaPath), notes: w.notes }); return; }
      const { path } = await N.otaDownload({ url: w.url, sha256: w.sha256, build: w.build });
      await N.otaApply({ path, build: w.build, now: false }); // بيتطبّق بالفتح الجاي لحاله
      store.set(LS.otaReady, w.build); store.set(LS.otaPath, path);
      showUpdateBar({ kind: 'web', build: w.build, path, notes: w.notes });
    }
  } catch (e) { console.warn('update check', e); }
  finally { updateChecking = false; }
}
function showUpdateBar(o) {
  const bar = $('updateBar');
  $('updateTitle').textContent = o.kind === 'web' ? 'وصل تحديث جديد للتطبيق ✨' : o.title;
  $('updateNotes').textContent = o.notes || (o.kind === 'web' ? 'رح يتطبّق لحاله بالفتح الجاي، أو طبّقه هلأ.' : 'حمّل النسخة الجديدة وثبّتها فوق القديمة، إعداداتك بتضل محفوظة.');
  $('updateNotes').hidden = false;
  const go = $('updateGo');
  go.textContent = o.kind === 'web' ? 'طبّقه هلأ' : 'حمّل';
  go.onclick = async () => {
    if (o.kind === 'web') {
      try { await P('SarrafNative').otaApply({ path: o.path, build: o.build, now: true }); } catch { toast('ما زبط التحديث'); }
    } else openExternal(o.url);
  };
  $('updateClose').hidden = !!o.force;
  bar.hidden = false;
}

// ================= قديم ⇄ جديد =================

// ================= قديم ⇄ جديد =================
function fmtInput(raw, maxDec) {
  let t = normalizeDigits(raw).replace(/[^\d.]/g, '');
  const i = t.indexOf('.');
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '').slice(0, maxDec);
  if (maxDec === 0) t = t.replace('.', '');
  const [a, b] = t.split('.');
  const intPart = (a || '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return b !== undefined ? `${intPart || '0'}.${b}` : intPart;
}
let onActive = 'old'; // الحقل الذي يكتب فيه المستخدم
function onUpdate(from) {
  const oldEl = $('onOld'), newEl = $('onNew');
  if (from === 'old') {
    oldEl.value = fmtInput(oldEl.value, 0);
    const v = parseAmount(oldEl.value);
    newEl.value = oldEl.value ? fmtNum(v / RATIO, 2) : '';
    store.set(LS.onOld, v || 0);
  } else {
    newEl.value = fmtInput(newEl.value, 2);
    const v = parseAmount(newEl.value);
    oldEl.value = newEl.value ? fmtNum(v * RATIO, 0) : '';
    store.set(LS.onOld, v * RATIO || 0);
  }
  onActive = from;
  const resultIsNew = from === 'old';
  const val = parseAmount(resultIsNew ? newEl.value : oldEl.value);
  $('onWords').textContent = val ? '= ' + amountToWords(val, resultIsNew ? 'ليرة جديدة' : 'ليرة قديمة', resultIsNew ? 'قرش' : '') : '';
  document.querySelectorAll('#onQuick button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === parseAmount(oldEl.value))));
}
function setupOldNew() {
  $('onRatio').textContent = `1 ليرة جديدة = ${fmtNum(RATIO, 0)} ليرة قديمة`;
  $('onQuick').innerHTML = (CFG.OLD_QUICK_AMOUNTS || []).map((v) => `<button class="press" data-v="${v}">${fmtNum(v, 0)}</button>`).join('');
  $('onFields').classList.toggle('flip', state.onFlip);
  $('onSwap').classList.toggle('turn', state.onFlip);
  const saved = store.get(LS.onOld, 100000);
  $('onOld').value = saved ? String(saved) : '';
  onUpdate('old');
  $('onOld').addEventListener('input', () => onUpdate('old'));
  $('onNew').addEventListener('input', () => onUpdate('new'));
  $('onOld').addEventListener('focus', (e) => e.target.select());
  $('onNew').addEventListener('focus', (e) => e.target.select());
  $('onQuick').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $('onOld').value = b.dataset.v; onUpdate('old');
  });
  $('onSwap').addEventListener('click', () => {
    state.onFlip = !state.onFlip; store.set(LS.onFlip, state.onFlip);
    $('onSwap').classList.toggle('turn', state.onFlip);
    $('onFields').classList.toggle('flip', state.onFlip);
    const top = state.onFlip ? 'new' : 'old';
    onUpdate(top);
    $(top === 'old' ? 'onOld' : 'onNew').focus();
  });
  $('onCopy').addEventListener('click', async () => {
    const isNew = onActive === 'old';
    const text = `${(isNew ? $('onNew') : $('onOld')).value} ${isNew ? 'ليرة جديدة' : 'ليرة قديمة'}`;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {} ta.remove();
    }
    haptic(); toast('تم النسخ: ' + text);
  });
}

// ================= القائمة الجانبية والصفحات =================
let currentView = 'main';
const VIEWS = ['main', 'settings', 'about', 'privacy', 'order'];
function go(view) {
  closeDrawer();
  if (view === 'notifications') { go('settings'); setTimeout(() => $('notifySection').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }), 50); return; }
  for (const v of VIEWS) $('view-' + v).hidden = v !== view;
  currentView = view;
  if (view === 'settings') fillSettings();
  if (view === 'privacy') loadPrivacy();
  if (view === 'order') renderOrder();
  window.scrollTo(0, 0);
}
function openDrawer() {
  const bd = $('drawerBackdrop'), d = $('drawer');
  bd.hidden = false;
  void bd.offsetWidth; // يثبّت الحالة الابتدائية لتعمل حركة الانزلاق
  bd.classList.add('show'); d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  $('menuBtn').setAttribute('aria-expanded', 'true');
}
function closeDrawer() {
  const bd = $('drawerBackdrop'), d = $('drawer');
  if (!d.classList.contains('open')) return;
  d.classList.remove('open'); bd.classList.remove('show');
  d.setAttribute('aria-hidden', 'true');
  $('menuBtn').setAttribute('aria-expanded', 'false');
  setTimeout(() => { bd.hidden = true; }, reduceMotion ? 0 : 300);
}
const drawerOpen = () => $('drawer').classList.contains('open');

async function loadPrivacy() {
  const box = $('privacyBody');
  if (box.dataset.loaded) return;
  try {
    const html = await (await fetch('privacy.html')).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    box.innerHTML = doc.querySelector('main')?.innerHTML || '';
    box.dataset.loaded = '1';
  } catch { box.textContent = 'ما قدرنا نفتح الصفحة.'; }
}

function socialButtons() {
  return (CFG.SOCIAL || []).filter((s) => s.url && s.url.trim()).map((s) => {
    const ic = SOCIAL_ICONS[s.platform];
    const bg = s.platform === 'instagram' ? 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)'
      : s.platform === 'tiktok' ? '#000' : `#${ic?.hex || '444'}`;
    const svg = ic ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ic.path}"/></svg>` : '🔗';
    return `<button class="social-btn press" style="background:${bg}" data-url="${esc(s.url)}" aria-label="${esc(s.label || ic?.title)}" title="${esc(s.label || ic?.title)}">${svg}</button>`;
  }).join('');
}
function setupPeople() {
  const d = CFG.DEVELOPER || {};
  // الصورة من الملف اللي بتحطه (img/developer.png). إذا الملف مو موجود: الدائرة بتختفي بدل أيقونة عامة
  for (const id of ['devPhoto', 'drawerPhoto']) {
    const img = $(id);
    img.hidden = true;
    if (!d.photo) continue;
    img.onload = () => { img.hidden = !(img.naturalWidth > 1); };
    img.onerror = () => { img.hidden = true; };
    img.src = d.photo;
  }
  $('devName').textContent = d.name || '';
  $('devTagline').textContent = d.tagline || '';
  $('drawerName').textContent = d.name || '';
  $('drawerSub').textContent = d.subtitle || '';
  $('signature').textContent = `صنع بواسطة ${d.name || ''}`;
  document.querySelectorAll('[data-social]').forEach((el) => { el.innerHTML = socialButtons(); });
  document.querySelectorAll('[data-contact]').forEach((b) => {
    b.hidden = !CFG.CONTACT_URL;
    b.textContent = CFG.CONTACT_LABEL || 'تواصل معي';
  });
  const setVer = (v) => { $('appVersion').textContent = 'الإصدار ' + v; $('drawerVer').textContent = 'صرّاف · الإصدار ' + v; };
  setVer(CFG.APP_VERSION || '');
  P('App')?.getInfo().then((i) => setVer(i.version)).catch(() => {});
}

// 7 نقرات على رقم الإصدار → إظهار إعدادات المصدر (رابط الخادم والقنوات)
let devTaps = 0, devTapTimer = null;
function onVersionTap() {
  if (store.get(LS.dev)) { toast('إعدادات المصدر ظاهرة بالإعدادات'); return; }
  devTaps++;
  clearTimeout(devTapTimer);
  devTapTimer = setTimeout(() => { devTaps = 0; }, 2500);
  const left = DEV_TAPS - devTaps;
  if (left <= 0) {
    devTaps = 0;
    store.set(LS.dev, true);
    haptic();
    toast('تم إظهار إعدادات المصدر بالإعدادات');
  } else if (devTaps >= 3) toast(`باقي ${left} ${left === 1 ? 'نقرة' : left === 2 ? 'نقرتين' : 'نقرات'}`, 900);
}

// ================= معلومة طبية اليوم =================
async function loadTip() {
  const card = $('tipCard');
  card.hidden = true;
  const hiddenAt = store.get(LS.tipHiddenAt);
  if (hiddenAt && Date.now() - hiddenAt < 24 * 3600e3) return;
  const url = contentUrl();
  if (!url) return;
  try {
    const c = await (await fetchWithTimeout(url, 8000)).json();
    const tips = (c.tips || []).filter((t) => t && t.text);
    if (!tips.length) return;
    const day = Math.floor((Date.now() + 3 * 3600e3) / 86400e3);
    const tip = tips[day % tips.length];
    $('tipText').textContent = tip.text;
    $('tipVideo').hidden = !tip.video;
    $('tipVideo').onclick = () => openExternal(tip.video);
    card.hidden = false;
  } catch { /* بدون نت أو بدون محتوى: البطاقة لا تظهر */ }
}

// ================= الإشعار الصباحي + تنبيه السعر =================
// الموعد: منبّه دقيق أصلي (SarrafNative.setMorning). المحتوى: آخر أسعار التطبيق،
// والـ Background Runner بيحدّثه بأسعار طازة خلال الساعتين قبل الموعد.
function notifySettings() {
  const n = store.get(LS.notify, { enabled: false, time: CFG.NOTIFY_DEFAULT_TIME || '09:00' });
  if (!Array.isArray(n.times) || !n.times.length) n.times = [n.time || CFG.NOTIFY_DEFAULT_TIME || '09:00'];
  n.times = n.times.slice(0, CFG.NOTIFY_MAX_TIMES || 3);
  return n;
}
function changeSettings() { return store.get(LS.change, { enabled: false, pct: CFG.PRICE_CHANGE_PCT || 1, minHours: CFG.PRICE_CHANGE_MIN_HOURS || 2 }); }
function alertSettings() { return store.get(LS.alert, { enabled: false, dir: 'above', value: null }); }

// نص الإشعار: العملات المفعّلة بترتيب المستخدم + غرام 21 بعملة الذهب المختارة
const NOTIFY_ICON = { USD: '💵 ', TRY: '₺ ', EUR: '€ ' };
function morningText(r) {
  const m = state.mode, cur = state.goldCur, cfg = GOLD_CURS[cur];
  const lines = [];
  for (const id of enabledIds()) {
    if (id === 'GOLD') {
      const g = goldIn(r, '21', cur, m);
      if (g != null) lines.push(`🥇 غرام عيار 21: ${cur === 'USD' ? '$' : ''}${fmtNum(g, cur === 'USD' ? 2 : cfg.dec)}${cur !== 'USD' ? ' ' + cfg.sym : ''}${r.gold?.estimated ? ' (تقديري)' : ''}`);
      continue;
    }
    const p = priceOf(r, id);
    if (p) lines.push(`${NOTIFY_ICON[id] || ''}${SHORT_NAME[id]}: ${fmtNum(p.buy, 2)} / ${fmtNum(p.sell, 2)} ل.س`);
  }
  return lines.join('\n') || `💵 الدولار: ${fmtNum(r.usd_syp.buy, 2)} / ${fmtNum(r.usd_syp.sell, 2)} ل.س`;
}

async function runnerEvent(event, details = {}) {
  const BR = P('BackgroundRunner');
  if (!BR) return null;
  return BR.dispatchEvent({ label: RUNNER_LABEL, event, details });
}
async function pushRunnerSettings() {
  const n = notifySettings();
  try {
    await runnerEvent('configure', {
      enabled: n.enabled, time: n.times[0], times: n.times, apiUrl: apiUrl(), channels: channels(),
      goldChannels: CFG.GOLD_CHANNELS || '', goldApi: CFG.GOLD_API, contentUrl: contentUrl(),
      goldCur: state.goldCur, oldPerNew: RATIO, mode: state.mode, alert: alertSettings(),
      change: changeSettings(), order: enabledIds(),
    });
  } catch (e) { console.warn('runner configure', e); }
}
async function pushMorning() {
  const N = P('SarrafNative');
  if (!N) return null;
  const n = notifySettings();
  try {
    return await N.setMorning({ enabled: n.enabled, times: n.times, ...(state.rates ? { body: morningText(state.rates) } : {}) });
  } catch (e) { console.warn('setMorning', e); return null; }
}
async function ensureNotifyPermission() {
  const LN = P('LocalNotifications');
  if (!LN) return false;
  try {
    let s = await LN.checkPermissions();
    if (s.display !== 'granted') s = await LN.requestPermissions();
    return s.display === 'granted';
  } catch { return false; }
}
async function setNotify(enabled, times) {
  const n = notifySettings();
  if (enabled && !(await ensureNotifyPermission())) {
    enabled = false;
    $('notifyStatus').textContent = 'ما في صلاحية للإشعارات. فعّلها من إعدادات الجهاز ← التطبيقات ← صرّاف.';
  }
  const t = (times || n.times).filter(Boolean).slice(0, CFG.NOTIFY_MAX_TIMES || 3);
  store.set(LS.notify, { enabled, time: t[0], times: t });
  await pushRunnerSettings();
  await pushMorning();
  return enabled;
}
function setupNotifyPrompt() {
  const card = $('notifyPrompt');
  const launches = store.get(LS.launches, 0) + 1;
  store.set(LS.launches, launches);
  if (!isNative || launches < 2 || store.get(LS.notifyPrompted) || notifySettings().enabled) return;
  $('notifyPromptTime').textContent = notifySettings().times[0];
  card.hidden = false;
  $('notifyYes').onclick = async () => { store.set(LS.notifyPrompted, true); card.hidden = true; await setNotify(true); };
  $('notifyNo').onclick = () => { store.set(LS.notifyPrompted, true); card.hidden = true; };
}

// إذا النظام ممكن يأخّر أو يمنع الإشعار (توفير البطارية / منع الخلفية / بدون منبّهات دقيقة) منشرح للمستخدم شو يعمل
async function checkBackground() {
  const box = $('bgWarn'), N = P('SarrafNative');
  box.hidden = true;
  if (!N || !(notifySettings().enabled || alertSettings().enabled || changeSettings().enabled)) return;
  let s;
  try { s = await N.status(); } catch { return; }
  const problems = [];
  if (!s.exact) problems.push('صلاحية "المنبّهات والتذكيرات" مسكّرة، فالإشعار الصباحي ممكن يتأخر كم دقيقة.');
  if (s.backgroundRestricted) problems.push('النظام مانع التطبيق يشتغل بالخلفية، فتنبيه السعر وتحديث الويدجت ما رح يشتغلوا.');
  else if (!s.ignoringBattery) problems.push('توفير البطارية مفعّل للتطبيق، فممكن النظام يأخّر تحديث الأسعار بالخلفية وتنبيه السعر.');
  if (!problems.length) return;
  $('bgWarnText').textContent = problems.join(' ');
  const man = String(s.manufacturer || '').toLowerCase();
  const steps = ['اضغط "افتح إعدادات البطارية" تحت.', 'اختار "صرّاف" من القائمة (إذا ما بيّن، اختار "كل التطبيقات").', 'اختار "بدون قيود" أو "عدم التحسين".'];
  if (/xiaomi|redmi|poco/.test(man)) steps.push('على شاومي كمان: الإعدادات ← التطبيقات ← صرّاف ← "التشغيل التلقائي" شغّال، و"توفير البطارية" ← "بلا قيود".');
  else if (/huawei|honor/.test(man)) steps.push('على هواوي كمان: الإعدادات ← البطارية ← تشغيل التطبيقات ← صرّاف ← "إدارة يدوية" وفعّل الخيارات التلاتة.');
  else if (/samsung/.test(man)) steps.push('على سامسونج كمان: الإعدادات ← البطارية ← حدود استخدام الخلفية ← شيل صرّاف من "التطبيقات النائمة".');
  else if (/oppo|realme|vivo|oneplus/.test(man)) steps.push('كمان: الإعدادات ← البطارية ← صرّاف ← "السماح بالنشاط بالخلفية".');
  $('bgWarnSteps').innerHTML = steps.map((t) => `<li>${esc(t)}</li>`).join('');
  $('bgFixExact').hidden = s.exact;
  box.hidden = false;
}

function describeNext(nextAt) {
  if (!nextAt || nextAt < 0) return '';
  try {
    return new Intl.DateTimeFormat('ar-SY-u-nu-latn', { timeZone: 'Asia/Damascus', weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(nextAt));
  } catch { return ''; }
}
async function fillSettings() {
  $('sourceSection').hidden = !store.get(LS.dev);
  $('apiUrl').value = apiUrl();
  $('channels').value = channels().join(', ');
  const n = notifySettings();
  $('notifyEnabled').checked = n.enabled;
  renderTimes();
  const c = changeSettings();
  $('changeEnabled').checked = !!c.enabled;
  $('changePct').value = String(c.pct);
  renderChangeStatus();
  $('notifyTest').hidden = !isNative;
  if (!isNative) $('notifyStatus').textContent = 'الإشعارات بتشتغل بس جوا تطبيق أندرويد.';
  else if (!n.enabled) $('notifyStatus').textContent = 'الإشعار مطفي.';
  else {
    const st = await P('SarrafNative')?.status().catch(() => null);
    const when = describeNext(st?.nextAt);
    $('notifyStatus').textContent = `رح يوصلك ${n.times.length === 1 ? 'إشعار' : n.times.length === 2 ? 'إشعارين' : n.times.length + ' إشعارات'} كل يوم الساعة ${n.times.join(' و ')} بتوقيت دمشق${when ? ` (الجاي: ${when})` : ''}.`;
  }
  const a = alertSettings();
  $('alertEnabled').checked = !!a.enabled;
  $('alertValue').value = a.value ? String(a.value) : '';
  if (!a.value && state.rates) $('alertValue').placeholder = fmtNum(Math.round(state.rates.usd_syp[state.mode] * 1.03), 0);
  document.querySelectorAll('#alertDir [data-dir]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.dir === a.dir)));
  renderAlertStatus();
  checkBackground();
}
// أوقات الإشعار (1 لـ 3)
function renderTimes() {
  const n = notifySettings(), max = CFG.NOTIFY_MAX_TIMES || 3;
  $('notifyTimes').innerHTML = n.times.map((t, i) => `<div class="time-row">
      <input class="text-in time-in" type="time" dir="ltr" value="${esc(t)}" data-i="${i}" aria-label="الوقت ${i + 1}" />
      ${n.times.length > 1 ? `<button class="ghost press small-btn time-del" data-del="${i}" aria-label="حذف الوقت">حذف</button>` : ''}
    </div>`).join('');
  $('addTime').hidden = n.times.length >= max;
}
async function saveTimes(times) {
  await setNotify(notifySettings().enabled, times);
  fillSettings();
}
function renderChangeStatus() {
  const c = changeSettings();
  $('changeStatus').textContent = !isNative ? 'التنبيه بيشتغل بس جوا تطبيق أندرويد.'
    : c.enabled ? `رح يوصلك إشعار إذا تغيّر الدولار أو التركي أو الذهب (المفعّلين) أكتر من ${fmtNum(c.pct, 2)}% عن آخر سعر بلّغناك فيه. الفحص كل ربع ساعة تقريباً.`
      : 'التنبيه مطفي.';
}
async function saveChange(patch) {
  let c = { ...changeSettings(), ...patch };
  if (!(c.pct > 0)) c.pct = CFG.PRICE_CHANGE_PCT || 1;
  if (c.enabled && isNative && !(await ensureNotifyPermission())) { c.enabled = false; toast('لازم تسمح بالإشعارات'); }
  store.set(LS.change, c);
  $('changeEnabled').checked = !!c.enabled;
  renderChangeStatus();
  await pushRunnerSettings();
  checkBackground();
}

// ================= شاشة ترتيب العملات =================
function renderOrder() {
  const NAMES = Object.fromEntries([...CURRENCIES.map((c) => [c.id, c]), ['GOLD', { name: 'الذهب (القسم كامل)', flag: '🥇', fam: 'gold', code: 'عيارات + حاسبة' }]]);
  $('orderList').innerHTML = getOrder().map((o) => {
    const c = NAMES[o.id];
    return `<div class="order-row fam-${c.fam}" role="listitem" data-id="${o.id}">
      <button class="drag" aria-label="اسحب لتغيير الترتيب">⠿</button>
      <span class="flag">${flagHtml(c.flag)}</span>
      <div class="meta"><div class="name">${c.name}</div><div class="code">${esc(c.code || '')}</div></div>
      <label class="toggle"><input type="checkbox" ${o.on ? 'checked' : ''} data-on="${o.id}" aria-label="إظهار ${c.name}"><i></i></label>
    </div>`;
  }).join('');
}
function saveOrderFromDom() {
  const list = [...$('orderList').querySelectorAll('.order-row')].map((el) => ({ id: el.dataset.id, on: el.querySelector('[data-on]').checked }));
  store.set(LS.order, list);
  render(false);
  if (state.rates) afterNewRates(state.rates);
  pushRunnerSettings();
}
function setupOrder() {
  const box = $('orderList');
  box.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-on]'); if (!cb) return;
    const anyCurrency = [...box.querySelectorAll('[data-on]')].some((x) => x.checked && x.dataset.on !== 'GOLD');
    if (!anyCurrency) { cb.checked = true; toast('لازم تضل عملة وحدة مفعّلة على الأقل'); return; }
    saveOrderFromDom();
  });
  // سحب وإفلات بالمقبض ⠿ (لمس أو ماوس)
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.drag'); if (!h) return;
    const row = h.closest('.order-row');
    drag = { row, y: e.clientY, id: e.pointerId };
    row.classList.add('dragging');
    h.setPointerCapture(e.pointerId);
    haptic();
    e.preventDefault();
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    drag.row.style.transform = `translateY(${dy}px)`;
    const rows = [...box.querySelectorAll('.order-row')];
    const i = rows.indexOf(drag.row), h = drag.row.offsetHeight;
    if (dy > h * 0.6 && rows[i + 1]) { rows[i + 1].after(drag.row); drag.y += h; drag.row.style.transform = `translateY(${e.clientY - drag.y}px)`; haptic(); }
    else if (dy < -h * 0.6 && rows[i - 1]) { rows[i - 1].before(drag.row); drag.y -= h; drag.row.style.transform = `translateY(${e.clientY - drag.y}px)`; haptic(); }
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.row.classList.remove('dragging');
    drag.row.style.transform = '';
    drag = null;
    saveOrderFromDom();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  $('orderReset').addEventListener('click', () => { store.set(LS.order, null); renderOrder(); saveOrderFromDom(); toast('رجع الترتيب الأصلي'); });
}

// ================= سحب لتحت للتحديث + ضغطة مطوّلة =================
function setupPullToRefresh() {
  const ptr = $('ptr');
  let y0 = null, dy = 0;
  const blocked = () => currentView !== 'main' || drawerOpen() || !$('shareSheet').hidden || !$('updModal').hidden;
  window.addEventListener('touchstart', (e) => {
    if (blocked() || window.scrollY > 0 || state.loading) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 4) { ptr.classList.add('pull'); ptr.style.transform = `translate(-50%, ${Math.min(dy * 0.5, 64)}px) rotate(${dy * 2}deg)`; }
  }, { passive: true });
  window.addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    if (dy > 90) { haptic(); refresh({ manual: true }); loadRemoteHistory(); }
    else { ptr.classList.remove('pull'); ptr.style.transform = ''; }
  });
}
function setupLongPress() {
  let t = null, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(t); t = null; };
  $('view-main').addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card, .chip');
    if (!card || e.target.closest('input, select, textarea')) return;
    sx = e.clientX; sy = e.clientY;
    t = setTimeout(() => { t = null; haptic(); go('order'); }, 650);
  });
  $('view-main').addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  $('view-main').addEventListener('pointerup', cancel);
  $('view-main').addEventListener('pointercancel', cancel);
}

function renderAlertStatus() {
  const a = alertSettings();
  const kind = state.mode === 'sell' ? 'المبيع' : 'الشراء';
  $('alertStatus').textContent = !isNative ? 'التنبيه بيشتغل بس جوا تطبيق أندرويد.'
    : a.enabled && a.value ? `رح يوصلك إشعار مرة وحدة لما يصير سعر ${kind} ${a.dir === 'below' ? 'تحت' : 'فوق'} ${fmtNum(a.value, 2)} ل.س. الفحص كل ربع ساعة تقريباً.`
      : 'التنبيه مطفي.';
}
async function saveAlert(patch) {
  let a = { ...alertSettings(), ...patch };
  if (a.enabled && !(a.value > 0)) { a.enabled = false; toast('اكتب السعر أول'); }
  if (a.enabled && isNative && !(await ensureNotifyPermission())) { a.enabled = false; toast('لازم تسمح بالإشعارات'); }
  store.set(LS.alert, a);
  $('alertEnabled').checked = !!a.enabled;
  renderAlertStatus();
  await pushRunnerSettings();
  if (a.enabled) runnerEvent('alertNow').catch(() => {});
  checkBackground();
}

// ================= الأحداث =================
function init() {
  // دخول البطاقات بالتتابع (60ms بين كل وحدة)
  if (!reduceMotion && Element.prototype.animate) {
    document.querySelectorAll('#view-main .enter').forEach((el, i) => {
      const anim = el.animate(
        [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
        { duration: 280, delay: i * 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
      // أمان: حتى لو توقفت الإطارات، المحتوى يظهر بعد وقت قصير
      setTimeout(() => anim.cancel(), i * 60 + 450);
    });
  }

  // اهتزاز خفيف عند ضغط أي زر أو بطاقة
  document.addEventListener('pointerdown', (e) => { if (e.target.closest('.press, .chip, .seg button, .social-btn')) haptic(); }, { passive: true });

  const amt = $('amount');
  amt.value = store.get(LS.amount, '1');
  amt.addEventListener('input', () => {
    const n = normalizeDigits(amt.value).replace(/[^\d.,]/g, '');
    if (n !== amt.value) amt.value = n;
    store.set(LS.amount, amt.value);
    renderResults(false);
  });
  amt.addEventListener('focus', () => amt.select());
  $('quickAmts').innerHTML = (CFG.QUICK_AMOUNTS || []).map((v) => `<button class="press" data-v="${v}">${fmtNum(v, 0)}</button>`).join('');
  $('quickAmts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    amt.value = b.dataset.v; store.set(LS.amount, amt.value); renderResults(true);
  });

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    state.tab = b.dataset.tab; store.set(LS.tab, state.tab); renderTabs();
  });
  $('srcChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.src = b.dataset.id; store.set(LS.src, state.src);
    renderChips(); renderResults(false);
  });
  $('karatPick').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.karat = b.dataset.k; store.set(LS.karat, state.karat);
    renderChips(); renderResults(false);
  });
  $('results').addEventListener('change', (e) => {
    if (e.target.id !== 'resKarat') return;
    state.resKarat = e.target.value; store.set(LS.resKarat, state.resKarat);
    renderResults(false);
  });
  document.querySelector('.mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    state.mode = b.dataset.mode; store.set(LS.mode, state.mode);
    renderChips(); renderResults(true); renderGold(true); renderChart();
    pushRunnerSettings();
    if (state.rates) afterNewRates(state.rates);
  });
  $('goldCur').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cur]'); if (!b) return;
    state.goldCur = b.dataset.cur; store.set(LS.goldCur, state.goldCur);
    renderGold(true); // تدحرج من قيمة العملة السابقة للجديدة
    pushRunnerSettings();
    if (state.rates && notifySettings().enabled) P('SarrafNative')?.setMorning({ body: morningText(state.rates) }).catch(() => {});
  });
  $('gcGrams').value = store.get(LS.gcGrams, '1');
  $('gcFee').value = store.get(LS.gcFee, '');
  for (const [id, key] of [['gcGrams', LS.gcGrams], ['gcFee', LS.gcFee]]) {
    $(id).addEventListener('input', (e) => {
      const n = normalizeDigits(e.target.value).replace(/[^\d.]/g, '');
      if (n !== e.target.value) e.target.value = n;
      store.set(key, n); renderGoldCalc(false);
    });
    $(id).addEventListener('focus', (e) => e.target.select());
  }
  $('gcDir').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]'); if (!b) return;
    state.gcDir = b.dataset.dir; store.set(LS.gcDir, state.gcDir);
    $('gcGrams').value = state.gcDir === 'm2g' ? '' : '1';
    store.set(LS.gcGrams, $('gcGrams').value);
    renderGoldCalc(false);
    $('gcGrams').focus();
  });
  $('gcKarat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    state.gcKarat = b.dataset.k; store.set(LS.gcKarat, state.gcKarat); renderGoldCalc(true);
  });
  $('timesBtn').addEventListener('click', () => {
    const open = $('timesMore').hidden;
    $('timesMore').hidden = !open; $('timesBtn').setAttribute('aria-expanded', String(open));
  });
  $('shareBtn').addEventListener('click', openShareSheet);
  $('shareBackdrop').addEventListener('click', closeShareSheet);
  $('shareSheet').addEventListener('click', (e) => { const b = e.target.closest('[data-share]'); if (b) shareRates(b.dataset.share); });
  $('updateClose').addEventListener('click', () => { $('updateBar').hidden = true; });
  $('chartWhat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-what]'); if (!b) return;
    state.chartWhat = b.dataset.what; store.set(LS.chartWhat, state.chartWhat); renderChart();
  });
  $('chartRange').addEventListener('click', (e) => {
    const b = e.target.closest('[data-days]'); if (!b) return;
    state.chartDays = +b.dataset.days; store.set(LS.chartDays, state.chartDays); renderChart();
  });

  // القائمة والتنقل
  $('menuBtn').addEventListener('click', openDrawer);
  $('drawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go);
    if (e.target.closest('[data-back]')) go(currentView === 'privacy' ? 'about' : currentView === 'order' ? 'settings' : 'main');
    const s = e.target.closest('.social-btn'); if (s) openExternal(s.dataset.url);
    if (e.target.closest('[data-contact]')) openExternal(CFG.CONTACT_URL);
  });
  $('signature').addEventListener('click', openDrawer);
  $('checkUpdBtn').addEventListener('click', () => { closeDrawer(); checkApkUpdate(true); });
  $('updGo').addEventListener('click', () => startApkUpdate());
  $('updLater').addEventListener('click', () => { if (apkInfo) store.set(LS.updSkip, apkInfo.versionCode); closeUpdModal(); });
  $('updBackdrop').addEventListener('click', () => { if (!apkReady) closeUpdModal(); });
  $('appVersion').addEventListener('click', onVersionTap);
  $('tipClose').addEventListener('click', () => { store.set(LS.tipHiddenAt, Date.now()); $('tipCard').hidden = true; });

  // الإعدادات (المصدر: مخفية إلا بعد 7 نقرات على الإصدار)
  $('saveSettings').addEventListener('click', () => {
    store.set(LS.api, $('apiUrl').value.trim());
    store.set(LS.channels, $('channels').value.split(',').map((s) => s.trim().replace(/^@|^https?:\/\/t\.me\/(s\/)?/g, '')).filter(Boolean));
    state.remoteHist = null;
    pushRunnerSettings();
    go('main');
    refresh({ manual: true }); loadTip(); loadRemoteHistory(); checkUpdates();
  });
  $('hideDev').addEventListener('click', () => { store.set(LS.dev, false); $('sourceSection').hidden = true; });
  $('notifyEnabled').addEventListener('change', async (e) => {
    const on = await setNotify(e.target.checked);
    e.target.checked = on;
    store.set(LS.notifyPrompted, true);
    fillSettings();
  });
  $('notifyTimes').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-i]'); if (!inp || !inp.value) return;
    const t = notifySettings().times; t[+inp.dataset.i] = inp.value; saveTimes(t);
  });
  $('notifyTimes').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]'); if (!d) return;
    const t = notifySettings().times; t.splice(+d.dataset.del, 1); saveTimes(t);
  });
  $('addTime').addEventListener('click', () => {
    const t = notifySettings().times;
    const next = ['09:00', '14:00', '20:00'].find((x) => !t.includes(x)) || '12:00';
    t.push(next); saveTimes(t);
  });
  $('changeEnabled').addEventListener('change', (e) => saveChange({ enabled: e.target.checked, pct: parseAmount($('changePct').value) }));
  $('changePct').addEventListener('change', (e) => saveChange({ pct: parseAmount(e.target.value) }));
  $('notifyTest').addEventListener('click', async () => {
    if (!(await ensureNotifyPermission())) { $('notifyStatus').textContent = 'ما في صلاحية للإشعارات.'; return; }
    await pushRunnerSettings();
    await pushMorning();
    // الـ runner بيجهّز النص بأسعار طازة، بعدين المنبّه الأصلي بيبعته (نفس مسار الإشعار الصباحي)
    try { await Promise.race([runnerEvent('prepareNow'), new Promise((r) => setTimeout(r, 15000))]); } catch {}
    try { await P('SarrafNative').fireMorningNow(); toast('انبعت إشعار تجريبي'); }
    catch { $('notifyStatus').textContent = 'ما قدرنا نبعت الإشعار التجريبي.'; }
  });
  $('bgFixBattery').addEventListener('click', () => P('SarrafNative')?.openBatterySettings().catch(() => P('SarrafNative')?.openAppSettings()));
  $('bgFixExact').addEventListener('click', () => P('SarrafNative')?.openExactAlarmSettings());
  $('alertDir').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]'); if (!b) return;
    document.querySelectorAll('#alertDir [data-dir]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    saveAlert({ dir: b.dataset.dir });
  });
  $('alertValue').addEventListener('change', (e) => {
    const v = parseAmount(e.target.value);
    saveAlert({ value: v > 0 ? v : null });
  });
  $('alertEnabled').addEventListener('change', (e) => {
    const v = parseAmount($('alertValue').value);
    saveAlert({ enabled: e.target.checked, value: v > 0 ? v : null });
  });

  // زر الرجوع في أندرويد
  P('App')?.addListener('backButton', () => {
    if (drawerOpen()) return closeDrawer();
    if (!$('shareSheet').hidden) return closeShareSheet();
    if (!$('updModal').hidden) return closeUpdModal();
    if (currentView === 'order') return go('settings');
    if (currentView === 'privacy') return go('about');
    if (currentView !== 'main') return go('main');
    P('App').exitApp();
  });

  window.addEventListener('online', () => { refresh(); loadTip(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (Date.now() - lastAttemptAt >= nextDelay() - 5000) refresh();
    if (currentView === 'settings') fillSettings(); // بعد الرجوع من إعدادات البطارية
    // رجع من صفحة "السماح بالتثبيت": منكمّل التثبيت لحاله
    if (waitingInstallPerm && apkReady) { waitingInstallPerm = false; installDownloaded(); }
  });
  setInterval(() => { renderRates(false); renderGold(false); renderStatus(); }, 30000);

  setupPeople();
  setupOldNew();
  setupOrder();
  setupPullToRefresh();
  setupLongPress();
  render(false);
  refresh();
  loadTip();
  loadRemoteHistory();
  setupNotifyPrompt();
  pushRunnerSettings();
  if (notifySettings().enabled) pushMorning();
  // التحديث الهوائي: الواجهة اشتغلت تمام → نثبّتها (بدون هالإشارة بترجع للنسخة القديمة بالفتح الجاي)
  P('SarrafNative')?.otaReady().catch(() => {});
  setTimeout(checkUpdates, 4000);
  setTimeout(() => checkApkUpdate(false), 2500);
  setInterval(checkUpdates, 6 * 3600e3);
}

init();
// للتجربة من المتصفح
window.__sarraf = { buildShareCanvas, state, refresh, render, nextDelay, shareCaption, morningText, getOrder };
