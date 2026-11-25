// منطق تجميع الأسعار (عملات + ذهب + حوالات). مشترك بين الـ Worker والتطبيق والـ Background Runner.
import { parseChannelPage, parseGoldPage } from './parser.js';

// القيم الافتراضية؛ تُغيَّر من wrangler.toml بدون تعديل الكود
export const DEFAULTS = {
  CHANNELS: 'exchange_Currencyy,aboothman33',
  GOLD_CHANNELS: '',                                    // فارغ = نفس قنوات العملات (الذهب من نشرات تلغرام/واتساب فقط)
  GOLD_API: '',                                         // معطّل: الذهب حصراً من نشرة التليجرام أو الواتساب وليس البورصة العالمية
  FX_API: 'https://open.er-api.com/v6/latest/USD',
};
export const JUMP_LIMIT = 0.10;      // رفض أي قفزة أكبر من 10% عن آخر سعر محفوظ...
export const JUMP_MAX_AGE_MS = 48 * 3600 * 1000; // لا يُرفض السعر الحقيقي إذا كان السعر المحفوظ أقدم من 48 ساعة
export const CONFIRM_LIMIT = 0.02;   // ...إلا إذا أكدها مصدر آخر بفرق أقل من 2%
export const DISAGREE_LIMIT = 0.02;  // فرق أكبر من 2% بين القناتين = تنبيه "المصادر مختلفة"
export const FRESH_ADVANTAGE_MS = 15 * 60 * 1000; // المصدر الأحدث بأكثر من 15 دقيقة يتقدّم على الأقدم
// عملات الحوالات: محسوبة من السعر العالمي × دولار السوق
export const REMIT = ['SAR', 'AED', 'KWD', 'JOD'];
const OZ_GRAMS = 31.1034768;

export const list = (s) => (Array.isArray(s) ? s : String(s || '').split(',')).map((x) => String(x).trim().replace(/^@/, '')).filter(Boolean);
const r4 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000);
const mid = (p) => (p ? (p.buy + p.sell) / 2 : null);
const diff = (a, b) => Math.abs(a - b) / b;
const tsOf = (iso) => { const n = iso ? Date.parse(iso) : NaN; return Number.isFinite(n) ? n : 0; };

async function defaultFetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sarraf/1.0)', 'Accept-Language': 'ar,en' },
    cf: { cacheTtl: 30 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// opts: { GOLD_CHANNELS, GOLD_API, FX_API, fetchGoldOunce(), last: {usd_syp:{buy,sell}}, extraSources: [] }
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

  // كل صفحة تُجلب مرة واحدة فقط حتى لو استُخدمت للعملات والذهب
  const pages = new Map();
  const getPage = (ch) => {
    if (!pages.has(ch)) pages.set(ch, Promise.resolve().then(() => fetchPage(ch)));
    return pages.get(ch);
  };

  // 1) كل القنوات + المصادر الإضافية (واتساب / اعتماد يدوي) مع بعض
  const fxP = Promise.resolve().then(fetchFx).catch((e) => ({ __error: String(e.message || e) }));
  const tgResults = await Promise.all(channels.map(async (ch, idx) => {
    try {
      const parsed = parseChannelPage(await getPage(ch));
      return parsed
        ? { channel: ch, kind: 'telegram', priority: idx + 10, ok: true, data: parsed }
        : { channel: ch, kind: 'telegram', priority: idx + 10, ok: false, error: 'لا توجد نشرة نصية' };
    } catch (e) {
      return { channel: ch, kind: 'telegram', priority: idx + 10, ok: false, error: String(e.message || e) };
    }
  }));

  const extra = Array.isArray(opts.extraSources) ? opts.extraSources : [];
  const extraResults = extra.map((src, idx) => {
    if (src && src.ok && src.data?.usd_syp) {
      return {
        channel: src.channel || src.source || 'whatsapp',
        kind: src.kind || 'whatsapp',
        priority: Number.isFinite(src.priority) ? src.priority : (src.kind === 'manual' ? -100 : idx),
        ok: true,
        data: src.data,
      };
    }
    return {
      channel: src?.channel || 'whatsapp',
      kind: src?.kind || 'whatsapp',
      priority: 100 + idx,
      ok: false,
      error: src?.error || 'المصدر غير متاح',
    };
  });

  const results = [...extraResults, ...tgResults];
  const tried = results.map(({ channel, kind, ok, error, data }) => (
    ok
      ? { channel, kind, ok, post_time: data.post_time || null, usd_syp: data.usd_syp }
      : { channel, kind, ok, error }
  ));

  // ترتيب حسب الأولوية والحداثة: الاعتماد اليدوي أولاً، وإلا الأحدث بأكثر من 15 دقيقة يتقدّم على الأقدم
  const good = results.filter((r) => r.ok).sort((a, b) => {
    if (a.kind === 'manual' && b.kind !== 'manual') return -1;
    if (b.kind === 'manual' && a.kind !== 'manual') return 1;
    const ta = tsOf(a.data.post_time), tb = tsOf(b.data.post_time);
    if (ta && tb && Math.abs(ta - tb) > FRESH_ADVANTAGE_MS) return tb - ta;
    if (ta && !tb) return -1;
    if (tb && !ta) return 1;
    return a.priority - b.priority;
  });
  if (!good.length) return { error: 'تعذر الحصول على الأسعار من كل القنوات', sources_tried: tried };

  // 2) فحص القفزة: أكثر من 10% عن آخر سعر محفوظ (الحديث <48 ساعة) مرفوض إلا إذا أكده مصدر آخر أو نشرتان متتاليتان
  const lastTs = tsOf(opts.last?.post_time || opts.last?.fetched);
  const lastFresh = !lastTs || (Date.now() - lastTs) <= JUMP_MAX_AGE_MS;
  const lastMid = lastFresh ? mid(opts.last?.usd_syp) : null;
  const confirmedBy = (cand) => {
    const m = mid(cand.data.usd_syp);
    const other = good.find((o) => o !== cand && diff(mid(o.data.usd_syp), m) <= CONFIRM_LIMIT);
    if (other) return other.channel;
    const prev = cand.data.previous?.usd_syp;
    if (prev && diff(mid(prev), m) <= CONFIRM_LIMIT) return cand.channel + ' (نشرتين متتاليتين)';
    return null;
  };
  const rejected = [];
  let pick = null;
  for (const cand of good) {
    if (cand.kind === 'manual') { pick = cand; break; }
    const m = mid(cand.data.usd_syp);
    if (lastMid && diff(m, lastMid) > JUMP_LIMIT) {
      const by = confirmedBy(cand);
      if (!by) {
        rejected.push({
          channel: cand.channel,
          kind: cand.kind,
          usd_syp: cand.data.usd_syp,
          post_time: cand.data.post_time || null,
          reason: 'قفزة أكبر من 10% بدون تأكيد',
        });
        continue;
      }
      cand.confirmed_by = by;
    }
    pick = cand; break;
  }
  if (!pick) return { error: 'السعر الجديد مشبوه (قفزة كبيرة بدون تأكيد)', rejected, sources_tried: tried };

  // 3) مقارنة المصادر الصالحة
  let disagree = null;
  if (good.length > 1) {
    const values = good.map((g) => ({ channel: g.channel, kind: g.kind, usd_syp: g.data.usd_syp, post_time: g.data.post_time || null }));
    const mids = values.map((v) => mid(v.usd_syp));
    const spread = (Math.max(...mids) - Math.min(...mids)) / Math.min(...mids);
    if (spread > DISAGREE_LIMIT) disagree = { spread: r4(spread), values };
  }

  const { previous, ...data } = { ...pick.data, source: pick.channel, source_kind: pick.kind };
  const derived = [];
  if (!data.try_usd && data.try_syp) {
    data.try_usd = {
      buy: r4(data.usd_syp.buy / data.try_syp.sell),
      sell: r4(data.usd_syp.sell / data.try_syp.buy),
    };
    derived.push('try_usd');
  }
  let fx = await fxP;
  if (fx && fx.__error) { tried.push({ channel: 'fx-api', kind: 'api', ok: false, error: fx.__error }); fx = null; }
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

  const goldChannels = list(cfg.GOLD_CHANNELS).length ? list(cfg.GOLD_CHANNELS) : channels;
  const extraGold = extra.filter((s) => s?.ok && s.gold).map((s) => ({ ...s.gold, source: s.channel || s.source || 'whatsapp', kind: s.kind || 'whatsapp' }));
  const gold = await buildGold(data, goldChannels, getPage, null, tried, extraGold);

  return {
    usd_syp: data.usd_syp,
    try_usd: data.try_usd || null,
    try_syp: data.try_syp || null,
    eur_syp: data.eur_syp || null,
    remit: Object.keys(remit).length ? remit : null,
    gold,
    city: data.city || null,
    post_time: data.post_time || null,
    post_id: data.post_id || null,
    source: data.source,
    source_kind: data.source_kind || 'telegram',
    confirmed_by: pick.confirmed_by || null,
    disagree,
    rejected: rejected.length ? rejected : null,
    derived,
    fetched: new Date().toISOString(),
    sources_tried: tried,
  };
}

// الذهب: يُؤخذ حصراً من نشرات التليجرام أو الواتساب أو الاعتماد اليدوي (وليس من البورصة العالمية)
async function buildGold(data, channels, getPage, _fetchGoldOunce, _tried, extraGold = []) {
  const tgGold = (await Promise.all(channels.map(async (ch) => {
    try {
      const parsed = parseGoldPage(await getPage(ch));
      return parsed ? { ...parsed, source: ch, kind: 'telegram' } : null;
    } catch { return null; }
  }))).filter(Boolean);

  const candidates = [...extraGold, ...tgGold];
  const hasExplicitGram = (c) => !!(c?.syp?.['21'] || c?.syp?.['24'] || c?.syp?.['18'] || c?.gram?.['21'] || c?.gram?.['24'] || c?.gram?.['18']);
  candidates.sort((a, b) => {
    if (a.kind === 'manual' && b.kind !== 'manual') return -1;
    if (b.kind === 'manual' && a.kind !== 'manual') return 1;
    const ag = hasExplicitGram(a), bg = hasExplicitGram(b);
    const ta = tsOf(a.post_time), tb = tsOf(b.post_time);
    if (ag !== bg) {
      // نشرة تحتوي سعر غرام صريح (عيار 21/24/18) تتقدّم على نشرة أونصة فقط ما لم تكن أقدم بأكثر من 24 ساعة
      if (ag && (!tb || ta >= tb - 24 * 3600e3)) return -1;
      if (bg && (!ta || tb >= ta - 24 * 3600e3)) return 1;
    }
    return tb - ta;
  });

  const g = candidates[0] || null;
  if (!g) return null;

  const usdSell = data.usd_syp.sell;
  const usdBuy = data.usd_syp.buy;
  const normSyp = (val) => {
    if (!Number.isFinite(val) || val <= 0) return null;
    let v = val;
    if (v / usdSell > 2000) v = v / 100; // تحويل الليرة القديمة إلى الجديدة
    return r4(v);
  };

  const syp = {}, sypBuy = {};
  const usd = {}, usdBuyMap = {};

  // 1) أسعار سوري صريحة من النشرة (مثل الاعتماد اليدوي أو نشرة واتساب/تلغرام بالليرة السورية)
  if (g.syp) {
    for (const k of ['24', '21', '18', 'lira']) {
      if (Number.isFinite(g.syp[k]) && g.syp[k] > 0) syp[k] = normSyp(g.syp[k]);
    }
  }
  if (g.syp_buy) {
    for (const k of ['24', '21', '18', 'lira']) {
      if (Number.isFinite(g.syp_buy[k]) && g.syp_buy[k] > 0) sypBuy[k] = normSyp(g.syp_buy[k]);
    }
  }

  // 2) أسعار غرامات من نشرة التليجرام أو الواتساب (بالدولار أو بالسوري، ومع دعم شراء/مبيع)
  for (const k of ['24', '21', '18']) {
    const it = g.gram?.[k];
    if (!it) continue;
    const sellVal = it.sell ?? it.value ?? it.buy;
    const buyVal = it.buy ?? it.value ?? it.sell;
    if (it.cur === 'syp') {
      if (!syp[k] && sellVal) syp[k] = normSyp(sellVal);
      if (!sypBuy[k] && buyVal) sypBuy[k] = normSyp(buyVal);
    } else if (it.cur === 'usd') {
      if (sellVal) usd[k] = r4(sellVal);
      if (buyVal) usdBuyMap[k] = r4(buyVal);
    }
  }
  if (g.lira) {
    const sellVal = g.lira.sell ?? g.lira.value ?? g.lira.buy;
    const buyVal = g.lira.buy ?? g.lira.value ?? g.lira.sell;
    if (g.lira.cur === 'syp') {
      if (!syp.lira && sellVal) syp.lira = normSyp(sellVal);
      if (!sypBuy.lira && buyVal) sypBuy.lira = normSyp(buyVal);
    } else if (g.lira.cur === 'usd') {
      if (sellVal) usd.lira = r4(sellVal);
      if (buyVal) usdBuyMap.lira = r4(buyVal);
    }
  }

  // 3) إكمال العيارات الناقصة انطلاقاً من عيار النشرة نفسه (عيار 21 أولاً، ثم 24، ثم 18) وليس من البورصة العالمية!
  const deriveMissing = (map) => {
    const base24 = map['21'] ? (map['21'] * 24) / 21
      : map['24'] ? map['24']
        : map['18'] ? (map['18'] * 24) / 18
          : null;
    if (!base24) return false;
    for (const k of ['24', '21', '18']) {
      if (!map[k]) map[k] = r4((base24 * +k) / 24);
    }
    if (!map.lira && map['21']) map.lira = r4(map['21'] * 8);
    return true;
  };

  const hasUsdGrams = deriveMissing(usd);
  if (Object.keys(usdBuyMap).length) deriveMissing(usdBuyMap);
  const hasSypGrams = deriveMissing(syp);
  if (Object.keys(sypBuy).length) deriveMissing(sypBuy);

  // الأونصة تُؤخذ فقط إذا ذُكرت داخل نشرة التليجرام أو الواتساب نفسها (لا نطلب gold-api أبداً)
  const ounce = Number.isFinite(g.ounce_usd) && g.ounce_usd > 500 ? r4(g.ounce_usd) : null;

  // تحويل بين USD و SYP حسب المتوفر من النشرة، وإذا لم تتوفر غرامات نهائياً نستخدم أونصة النشرة نفسها فقط
  if (!hasUsdGrams) {
    if (hasSypGrams) {
      for (const k of ['24', '21', '18', 'lira']) {
        if (syp[k]) usd[k] = r4(syp[k] / usdSell);
        if (sypBuy[k]) usdBuyMap[k] = r4(sypBuy[k] / usdBuy);
      }
    } else if (ounce) {
      const g24 = ounce / OZ_GRAMS;
      for (const k of ['24', '21', '18']) usd[k] = r4((g24 * +k) / 24);
      usd.lira = r4(usd['21'] * 8);
    }
  }

  if (!Object.keys(usd).length && !Object.keys(syp).length && !ounce) return null;

  const fromBulletinGram = hasUsdGrams || hasSypGrams;
  const hasBuySplit = Object.keys(usdBuyMap).length > 0 && (usdBuyMap['21'] !== usd['21']);
  const hasSypBuySplit = Object.keys(sypBuy).length > 0 && (sypBuy['21'] !== syp['21']);

  return {
    ounce_usd: ounce,
    usd,
    usd_buy: hasBuySplit ? usdBuyMap : null,
    syp: Object.keys(syp).length ? syp : null,
    syp_buy: hasSypBuySplit ? sypBuy : null,
    is_local: fromBulletinGram,
    estimated: !fromBulletinGram,
    post_time: g.post_time || null,
    ounce_time: ounce ? (g.post_time || null) : null,
    source: g.source || null,
    source_kind: g.kind || 'telegram',
  };
}
