// منطق تجميع الأسعار (عملات + ذهب + حوالات). مشترك بين الـ Worker والتطبيق والـ Background Runner.
import { parseChannelPage, parseGoldPage } from './parser.js';

// القيم الافتراضية؛ تُغيَّر من wrangler.toml بدون تعديل الكود
export const DEFAULTS = {
  CHANNELS: 'exchange_Currencyy,aboothman33',
  GOLD_CHANNELS: '',                                    // فارغ = نفس قنوات العملات
  GOLD_API: 'https://api.gold-api.com/price/XAU',      // احتياطي مجاني لسعر الأونصة
  FX_API: 'https://open.er-api.com/v6/latest/USD',
};
export const JUMP_LIMIT = 0.10;      // رفض أي قفزة أكبر من 10% عن آخر سعر محفوظ...
export const CONFIRM_LIMIT = 0.02;   // ...إلا إذا أكدها مصدر آخر بفرق أقل من 2%
export const DISAGREE_LIMIT = 0.02;  // فرق أكبر من 2% بين القناتين = تنبيه "المصادر مختلفة"
// عملات الحوالات: محسوبة من السعر العالمي × دولار السوق
export const REMIT = ['SAR', 'AED', 'KWD', 'JOD'];
const OZ_GRAMS = 31.1034768;

export const list = (s) => (Array.isArray(s) ? s : String(s || '').split(',')).map((x) => String(x).trim().replace(/^@/, '')).filter(Boolean);
const r4 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000);
const mid = (p) => (p ? (p.buy + p.sell) / 2 : null);
const diff = (a, b) => Math.abs(a - b) / b;

async function defaultFetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sarraf/1.0)', 'Accept-Language': 'ar,en' },
    cf: { cacheTtl: 30 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// opts: { GOLD_CHANNELS, GOLD_API, FX_API, fetchGoldOunce(), last: {usd_syp:{buy,sell}} }
// الدوال قابلة للحقن ليستخدم التطبيق نفس الكود مباشرة (بدون Worker)
export async function buildRates(channels, fetchPage, fetchFx, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  channels = list(channels);
  fetchPage = fetchPage || ((ch) => defaultFetchText(`https://t.me/s/${encodeURIComponent(ch)}`));
  fetchFx = fetchFx || (async () => {
    const d = JSON.parse(await defaultFetchText(cfg.FX_API));
    if (d.result !== 'success') throw new Error('FX bad response');
    return d.rates;
  });
  const fetchGoldOunce = opts.fetchGoldOunce || (async () => {
    const d = JSON.parse(await defaultFetchText(cfg.GOLD_API));
    return d.price;
  });

  // كل صفحة تُجلب مرة واحدة فقط حتى لو استُخدمت للعملات والذهب
  const pages = new Map();
  const getPage = (ch) => {
    if (!pages.has(ch)) pages.set(ch, Promise.resolve().then(() => fetchPage(ch)));
    return pages.get(ch);
  };

  // 1) كل القنوات مع بعض (بالتوازي)
  const fxP = Promise.resolve().then(fetchFx).catch((e) => ({ __error: String(e.message || e) }));
  const results = await Promise.all(channels.map(async (ch) => {
    try {
      const parsed = parseChannelPage(await getPage(ch));
      return parsed ? { channel: ch, ok: true, data: parsed } : { channel: ch, ok: false, error: 'لا توجد نشرة نصية' };
    } catch (e) {
      return { channel: ch, ok: false, error: String(e.message || e) };
    }
  }));
  const tried = results.map(({ channel, ok, error }) => (ok ? { channel, ok } : { channel, ok, error }));
  const good = results.filter((r) => r.ok);
  if (!good.length) return { error: 'تعذر الحصول على الأسعار من كل القنوات', sources_tried: tried };

  // 2) فحص القفزة: أكثر من 10% عن آخر سعر محفوظ مرفوض إلا إذا أكده مصدر آخر
  const lastMid = mid(opts.last?.usd_syp);
  const confirmedBy = (cand) => {
    const m = mid(cand.data.usd_syp);
    const other = good.find((o) => o !== cand && diff(mid(o.data.usd_syp), m) <= CONFIRM_LIMIT);
    if (other) return other.channel;
    // تأكيد ذاتي: النشرة السابقة بنفس القناة تقول نفس الشي (حتى لا يعلق التطبيق إذا قناة وحدة شغالة)
    const prev = cand.data.previous?.usd_syp;
    if (prev && diff(mid(prev), m) <= CONFIRM_LIMIT) return cand.channel + ' (نشرتين متتاليتين)';
    return null;
  };
  const rejected = [];
  let pick = null;
  for (const cand of good) {
    const m = mid(cand.data.usd_syp);
    if (lastMid && diff(m, lastMid) > JUMP_LIMIT) {
      const by = confirmedBy(cand);
      if (!by) { rejected.push({ channel: cand.channel, usd_syp: cand.data.usd_syp, reason: 'قفزة أكبر من 10% بدون تأكيد' }); continue; }
      cand.confirmed_by = by;
    }
    pick = cand; break;
  }
  if (!pick) return { error: 'السعر الجديد مشبوه (قفزة كبيرة بدون تأكيد)', rejected, sources_tried: tried };

  // 3) مقارنة المصادر
  let disagree = null;
  if (good.length > 1) {
    const values = good.map((g) => ({ channel: g.channel, usd_syp: g.data.usd_syp, post_time: g.data.post_time }));
    const mids = values.map((v) => mid(v.usd_syp));
    const spread = (Math.max(...mids) - Math.min(...mids)) / Math.min(...mids);
    if (spread > DISAGREE_LIMIT) disagree = { spread: r4(spread), values };
  }

  const { previous, ...data } = { ...pick.data, source: pick.channel };
  const derived = [];
  // التركي مقابل الدولار: من النشرة، وإلا من (الدولار/السوري) ÷ (التركي/السوري)، وإلا من API عالمي
  if (!data.try_usd && data.try_syp) {
    data.try_usd = {
      buy: r4(data.usd_syp.buy / data.try_syp.sell),
      sell: r4(data.usd_syp.sell / data.try_syp.buy),
    };
    derived.push('try_usd');
  }
  let fx = await fxP;
  if (fx && fx.__error) { tried.push({ channel: 'fx-api', ok: false, error: fx.__error }); fx = null; }
  if (fx) {
    if (!data.try_usd && fx.TRY) { data.try_usd = { buy: r4(fx.TRY), sell: r4(fx.TRY) }; derived.push('try_usd'); }
    if (!data.try_syp && data.try_usd) {
      data.try_syp = { buy: r4(data.usd_syp.buy / data.try_usd.sell), sell: r4(data.usd_syp.sell / data.try_usd.buy) };
      derived.push('try_syp');
    }
    if (!data.eur_syp && fx.EUR) {
      data.eur_syp = { buy: r4(data.usd_syp.buy / fx.EUR), sell: r4(data.usd_syp.sell / fx.EUR) };
      derived.push('eur_syp');
    }
  }
  // عملات الحوالات (دائماً محسوبة)
  const remit = {};
  for (const c of REMIT) {
    if (fx && fx[c]) remit[c.toLowerCase() + '_syp'] = { buy: r4(data.usd_syp.buy / fx[c]), sell: r4(data.usd_syp.sell / fx[c]), per_usd: fx[c] };
  }

  const gold = await buildGold(data, list(cfg.GOLD_CHANNELS).length ? list(cfg.GOLD_CHANNELS) : channels, getPage, fetchGoldOunce, tried);

  return {
    usd_syp: data.usd_syp,
    try_usd: data.try_usd || null,
    try_syp: data.try_syp || null,
    eur_syp: data.eur_syp || null,
    remit: Object.keys(remit).length ? remit : null,
    gold,
    city: data.city || null,
    post_time: data.post_time,
    post_id: data.post_id,
    source: data.source,
    confirmed_by: pick.confirmed_by || null,
    disagree,
    rejected: rejected.length ? rejected : null,
    derived,
    fetched: new Date().toISOString(),
    sources_tried: tried,
  };
}

// الذهب: سعر محلي بالليرة إن نشرته القناة، وإلا تقديري من الأونصة العالمية × سعر الدولار بالسوق
async function buildGold(data, channels, getPage, fetchGoldOunce, tried) {
  let g = null;
  for (const ch of channels) {
    try {
      const parsed = parseGoldPage(await getPage(ch));
      if (parsed) { g = { ...parsed, source: ch }; break; }
    } catch { /* القناة غير متاحة */ }
  }
  let ounce = g?.ounce_usd || null;
  if (!ounce && g?.gram?.['24']?.cur === 'usd') ounce = g.gram['24'].value * OZ_GRAMS;
  let ounceSource = g?.ounce_usd ? g.source : null;
  if (!ounce) {
    try { ounce = await fetchGoldOunce(); ounceSource = 'gold-api'; } catch (e) {
      tried.push({ channel: 'gold-api', ok: false, error: String(e.message || e) });
    }
  }

  const usdSell = data.usd_syp.sell;
  // أسعار محلية بالليرة (إن وُجدت) مع تحويل الليرة القديمة للجديدة
  const localSyp = (item) => {
    if (!item || item.cur !== 'syp') return null;
    let v = item.value;
    if (v / usdSell > 2000) v = v / 100; // الغرام لا يتجاوز 2000$؛ إذن الرقم بالليرة القديمة
    return r4(v);
  };
  const syp = {};
  for (const k of ['24', '21', '18']) { const v = localSyp(g?.gram?.[k]); if (v) syp[k] = v; }
  const lira = localSyp(g?.lira);
  if (lira) syp.lira = lira;

  const usd = {};
  const g24 = ounce ? ounce / OZ_GRAMS : null;
  for (const k of ['24', '21', '18']) {
    usd[k] = g24 ? r4((g24 * +k) / 24) : (syp[k] ? r4(syp[k] / usdSell) : null);
  }
  usd.lira = usd['21'] ? r4(usd['21'] * 8) : (syp.lira ? r4(syp.lira / usdSell) : null);
  if (!syp.lira && syp['21']) syp.lira = r4(syp['21'] * 8);

  if (!ounce && !Object.keys(syp).length) return null;
  return {
    ounce_usd: r4(ounce),
    usd,                 // سعر الغرام (والليرة الذهب) بالدولار
    syp: Object.keys(syp).length ? syp : null, // أسعار محلية بالليرة الجديدة إن نشرتها القناة
    estimated: !syp['21'],
    post_time: g?.post_time || null,
    source: g?.source || ounceSource,
  };
}
