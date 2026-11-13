// ===== مهام الخلفية (@capacitor/background-runner عبر WorkManager) =====
// أندرويد بيشغّل "dailyCheck" تقريباً كل 15 دقيقة (ممكن يتأخر حسب توفير البطارية). المهام:
//  1) إشعارات حسب الوقت (1 لـ 3 باليوم): المواعيد نفسها منبّه دقيق أصلي (MorningAlarm.java).
//     هون بس منجهّز النص بأسعار طازة خلال الساعتين قبل كل موعد، والمنبّه بيقرأ أحدث نص لحظة الإطلاق.
//  2) عند تغيّر السعر: إذا الدولار أو التركي أو الذهب تغيّر أكتر من النسبة المحددة (الافتراضي 1%)،
//     بحد أقصى إشعار كل ساعتين.
//  3) تنبيه سعر محدد: "خبّرني إذا الدولار صار فوق/تحت كذا" — مرة وحدة لكل قيمة.
//  4) الويدجت: إذا في ويدجت على الشاشة منحدّث الأسعار كل نص ساعة تقريباً.
// الإشعار بيعرض بس العملات المفعّلة وبترتيب المستخدم (settings.order).

const DAMASCUS_OFFSET_MIN = 3 * 60; // سوريا على UTC+3 طوال السنة
const PREPARE_BEFORE_MIN = 120;     // نجهّز نص الإشعار خلال الساعتين قبل كل موعد
const CHECK_EVERY_MIN = 14;         // أقل فاصل بين فحصين للتنبيهات
const WIDGET_EVERY_MIN = 29;        // أقل فاصل لتحديث أسعار الويدجت

function kvGet(key) {
  try {
    const r = CapacitorKV.get(key);
    const v = r && typeof r === 'object' ? r.value : r;
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}
function kvSet(key, val) { CapacitorKV.set(key, JSON.stringify(val)); }

function damascusNow(ms) {
  const d = new Date((ms || Date.now()) + DAMASCUS_OFFSET_MIN * 60000);
  return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const fmt = (v, dec) => {
  if (v == null || !isFinite(v)) return '—';
  const p = Number(v).toFixed(dec).split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return p[1] && +p[1] ? p.join('.') : p[0];
};
const minutesSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 60000 : Infinity);
const timesOf = (s) => (Array.isArray(s.times) && s.times.length ? s.times : [s.time || '09:00']).slice(0, 3);
const minOf = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

// العملات بالإشعار (بالترتيب): المفتاح بنتيجة الأسعار + الاسم + الرمز
const ITEMS = {
  USD: { key: 'usd_syp', label: '💵 الدولار' },
  TRY: { key: 'try_syp', label: '₺ التركي' },
  EUR: { key: 'eur_syp', label: '€ اليورو' },
  SAR: { key: 'sar_syp', remit: true, label: 'الريال السعودي' },
  AED: { key: 'aed_syp', remit: true, label: 'الدرهم الإماراتي' },
  KWD: { key: 'kwd_syp', remit: true, label: 'الدينار الكويتي' },
  JOD: { key: 'jod_syp', remit: true, label: 'الدينار الأردني' },
};
const pairOf = (r, it) => (it.remit ? r.remit && r.remit[it.key] : r[it.key]);
const enabledOrder = (s) => (Array.isArray(s.order) && s.order.length ? s.order : ['USD', 'SYP', 'SYP_OLD', 'TRY', 'EUR', 'GOLD']);

async function getRates(s) {
  // الـ Worker أولاً؛ القراءة المباشرة من تليجرام احتياط فقط
  if (s.apiUrl) {
    try {
      const res = await fetch(s.apiUrl);
      const d = await res.json();
      if (d && d.usd_syp) return d;
    } catch (e) { /* ننتقل للقراءة المباشرة */ }
  }
  const page = async (ch) => (await fetch('https://t.me/s/' + ch)).text();
  const fx = async () => (await (await fetch('https://open.er-api.com/v6/latest/USD')).json()).rates;
  const ounce = async () => (await (await fetch(s.goldApi || 'https://api.gold-api.com/price/XAU')).json()).price;
  const last = kvGet('lastRates');
  const d = await buildRates(s.channels || ['exchange_Currencyy'], page, fx, {
    fetchGoldOunce: ounce, GOLD_CHANNELS: s.goldChannels || '', last: last ? { usd_syp: last.usd_syp } : null,
  });
  if (d.error) throw new Error(d.error);
  return d;
}

// جلب مع حفظ؛ عند الفشل يرجع آخر سعر محفوظ مع stale=true
async function fresh(s) {
  try {
    const r = await getRates(s);
    if (!r.gold) { const old = kvGet('lastRates'); if (old && old.gold) r.gold = old.gold; }
    kvSet('lastRates', r);
    return { r, stale: false };
  } catch (e) {
    return { r: kvGet('lastRates'), stale: true };
  }
}

async function weeklyVideoLine(s, today) {
  if (!s.contentUrl) return '';
  const last = kvGet('lastVideoDay');
  if (last && (Date.parse(today) - Date.parse(last)) / 86400000 < 7) return '';
  try {
    const c = await (await fetch(s.contentUrl)).json();
    const v = c && c.weekly_video;
    if (!v || !v.url) return '';
    kvSet('lastVideoDay', today);
    return '\n🎬 ' + (v.title || 'فيديو جديد') + ': ' + v.url;
  } catch (e) { return ''; }
}

function g21Syp(r, mode) {
  if (!r || !r.gold) return null;
  if (r.gold.syp && r.gold.syp['21']) return r.gold.syp['21'];
  return r.gold.usd && r.gold.usd['21'] ? r.gold.usd['21'] * r.usd_syp[mode] : null;
}
function goldText(s, r) {
  const mode = s.mode === 'sell' ? 'sell' : 'buy';
  const g21 = g21Syp(r, mode);
  if (!g21) return '';
  const cur = s.goldCur || 'SYP', ratio = Number(s.oldPerNew) || 100;
  let t;
  if (cur === 'USD') t = '$' + fmt(g21 / r.usd_syp[mode], 2);
  else if (cur === 'TRY' && r.try_syp) t = fmt(g21 / r.try_syp[mode], 0) + ' ₺';
  else if (cur === 'SYP_OLD') t = fmt(g21 * ratio, 0) + ' ل.س قديمة';
  else t = fmt(g21, 0) + ' ل.س';
  return '🥇 غرام عيار 21: ' + t + (r.gold.estimated ? ' (تقديري)' : '');
}

// نص الإشعار: العملات المفعّلة بترتيب المستخدم + الذهب إذا مفعّل
function morningBody(s, r, stale) {
  const lines = [];
  for (const id of enabledOrder(s)) {
    if (id === 'GOLD') { const g = goldText(s, r); if (g) lines.push(g); continue; }
    const it = ITEMS[id];
    if (!it) continue; // الليرة السورية نفسها ما إلها سطر
    const p = pairOf(r, it);
    if (p) lines.push(it.label + ': ' + fmt(p.buy, 2) + ' / ' + fmt(p.sell, 2) + ' ل.س');
  }
  if (!lines.length) lines.push('💵 الدولار: ' + fmt(r.usd_syp.buy, 2) + ' / ' + fmt(r.usd_syp.sell, 2) + ' ل.س');
  if (stale) lines.push('⚠️ آخر سعر محفوظ — تعذّر التحديث');
  return lines.join('\n');
}

async function prepareMorning(s, r, stale, key) {
  if (!r) return false;
  const body = morningBody(s, r, stale) + await weeklyVideoLine(s, key.slice(0, 10));
  kvSet('morningBody', { body, at: Date.now() });
  kvSet('preparedKey', key);
  return true;
}

// أقرب موعد جاي خلال نافذة التجهيز: { key: 'يوم|وقت' } أو null
function upcomingSlot(s, ms) {
  const now = damascusNow(ms);
  let best = null;
  for (const t of timesOf(s)) {
    let before = minOf(t) - now.minutes;
    if (before <= 0) before += 1440; // الموعد بكرا (أو بعد نص الليل)
    if (before > PREPARE_BEFORE_MIN) continue;
    const day = damascusNow((ms || Date.now()) + before * 60000).day;
    if (!best || before < best.before) best = { before, key: day + '|' + t };
  }
  return best;
}

// تنبيه سعر محدد: يرجع true إذا انبعت إشعار
async function checkAlert(s, r) {
  const a = s.alert;
  if (!a || !a.enabled || !(a.value > 0) || !r || !r.usd_syp) return false;
  const mode = s.mode === 'sell' ? 'sell' : 'buy';
  const price = r.usd_syp[mode];
  const sig = a.dir + ':' + a.value;
  if (kvGet('alertFired') === sig) return false; // نفس التنبيه انبعت قبل
  const hit = a.dir === 'below' ? price <= a.value : price >= a.value;
  if (!hit) return false;
  await CapacitorNotifications.schedule([{
    id: 950,
    title: 'صرّاف – تنبيه السعر',
    body: 'الدولار صار ' + fmt(price, 2) + ' ل.س (' + (a.dir === 'below' ? 'تحت' : 'فوق') + ' ' + fmt(a.value, 2) + ')',
    scheduleAt: new Date(Date.now() + 1000),
    smallIcon: 'ic_stat_sarraf',
    autoCancel: true,
  }]);
  kvSet('alertFired', sig);
  return true;
}

// عند تغيّر السعر: الدولار/التركي/الذهب (المفعّلين) مقارنة بآخر سعر بلّغنا عنه
async function checkChange(s, r) {
  const c = s.change;
  if (!c || !c.enabled || !r || !r.usd_syp) return false;
  const pct = Number(c.pct) > 0 ? Number(c.pct) : 1;
  const minMs = (Number(c.minHours) > 0 ? Number(c.minHours) : 2) * 3600000;
  const mode = s.mode === 'sell' ? 'sell' : 'buy';
  const order = enabledOrder(s);
  const cur = {};
  if (order.indexOf('USD') >= 0) cur.USD = r.usd_syp[mode];
  if (order.indexOf('TRY') >= 0 && r.try_syp) cur.TRY = r.try_syp[mode];
  if (order.indexOf('GOLD') >= 0) { const g = g21Syp(r, mode); if (g) cur.GOLD = g; }
  const base = kvGet('changeBase');
  if (!base) { kvSet('changeBase', cur); return false; }
  const names = { USD: 'الدولار', TRY: 'التركي', GOLD: 'غرام 21' };
  const moved = [];
  for (const k of Object.keys(cur)) {
    if (!base[k] || !cur[k]) continue;
    const d = ((cur[k] - base[k]) / base[k]) * 100;
    if (Math.abs(d) >= pct) moved.push((d > 0 ? '▲ ' : '▼ ') + names[k] + ' ' + (d > 0 ? '+' : '') + d.toFixed(1) + '% → ' + fmt(cur[k], k === 'GOLD' ? 0 : 2) + ' ل.س');
  }
  if (!moved.length) return false;
  const last = kvGet('changeAt') || 0;
  if (Date.now() - last < minMs) return false; // حد أقصى إشعار كل ساعتين (والأساس بيضل متل ما هو)
  await CapacitorNotifications.schedule([{
    id: 960,
    title: 'صرّاف – تغيّر السعر',
    body: moved[0],
    largeBody: moved.join('\n'),
    scheduleAt: new Date(Date.now() + 1000),
    smallIcon: 'ic_stat_sarraf',
    autoCancel: true,
  }]);
  kvSet('changeBase', cur);
  kvSet('changeAt', Date.now());
  return true;
}

// الفحص الدوري
addEventListener('dailyCheck', async (resolve, reject) => {
  try {
    const s = kvGet('settings') || {};
    const last = kvGet('lastRates');
    const age = minutesSince(last && last.fetched);

    const slot = s.enabled ? upcomingSlot(s) : null;
    const needMorning = !!(slot && kvGet('preparedKey') !== slot.key);
    const needAlert = s.alert && s.alert.enabled && age >= CHECK_EVERY_MIN && kvGet('alertFired') !== s.alert.dir + ':' + s.alert.value;
    const needChange = s.change && s.change.enabled && age >= CHECK_EVERY_MIN;
    const needWidget = kvGet('widgetOn') === true && age >= WIDGET_EVERY_MIN;
    if (!needMorning && !needAlert && !needChange && !needWidget) return resolve();

    const { r, stale } = await fresh(s);
    if (needMorning) await prepareMorning(s, r, stale, slot.key);
    if (!stale) { await checkAlert(s, r); await checkChange(s, r); }
    resolve();
  } catch (e) { console.error('dailyCheck', e); reject(e); }
});

// حفظ الإعدادات القادمة من التطبيق
addEventListener('configure', (resolve, reject, args) => {
  try {
    const prev = kvGet('settings') || {};
    const next = Object.assign({}, prev, args || {});
    // تغيير الأوقات بيسمح بتجهيز نص جديد
    if (JSON.stringify(timesOf(prev)) !== JSON.stringify(timesOf(next))) kvSet('preparedKey', '');
    // تغيير نسبة التغيّر أو العملات المفعّلة: أساس جديد للمقارنة
    if (JSON.stringify(prev.change || null) !== JSON.stringify(next.change || null)
      || JSON.stringify(prev.order || null) !== JSON.stringify(next.order || null)) CapacitorKV.remove('changeBase');
    kvSet('settings', next);
    resolve();
  } catch (e) { reject(e); }
});

// تجهيز نص الإشعار فوراً (زر "إشعار تجريبي" — بعده التطبيق بيطلق الإشعار الأصلي)
addEventListener('prepareNow', async (resolve, reject) => {
  try {
    const s = kvGet('settings') || {};
    const { r, stale } = await fresh(s);
    await prepareMorning(s, r, stale, damascusNow().day + '|now');
    resolve({ ok: !!r });
  } catch (e) { reject(e); }
});

// فحص التنبيهات فوراً (بعد ما يحفظها المستخدم)
addEventListener('alertNow', async (resolve, reject) => {
  try {
    const s = kvGet('settings') || {};
    const { r, stale } = await fresh(s);
    const sent = stale ? false : await checkAlert(s, r);
    if (!stale) await checkChange(s, r);
    resolve({ sent });
  } catch (e) { reject(e); }
});
