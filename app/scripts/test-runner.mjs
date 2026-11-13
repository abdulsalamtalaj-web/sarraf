// اختبار سكربت الخلفية المولّد (www/runners/daily.js) ببيئة وهمية تحاكي Background Runner
// التشغيل: node scripts/test-runner.mjs   (بعد npm run sync-lib)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../www/runners/daily.js', import.meta.url), 'utf8');

function makeEnv({ usd = [146, 147], tr = [3.4, 3.5], nowIso }) {
  const kv = new Map();
  const sent = [];
  const handlers = {};
  let fetches = 0;
  const RealDate = Date;
  const fixed = RealDate.parse(nowIso);
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  }
  const page = `<div class="tgme_widget_message_wrap" data-post="x/1"><time datetime="${nowIso}"></time><div class="tgme_widget_message_text">الدولار<br>شراء ${usd[0]}<br>مبيع ${usd[1]}<br>التركي<br>شراء ${tr[0]}<br>مبيع ${tr[1]}</div></div>`;
  const ctx = {
    console, Date: FakeDate, Math, JSON, Promise, Map, Number, String, Object, Array, isFinite, parseInt, parseFloat, encodeURIComponent,
    CapacitorKV: { get: (k) => (kv.has(k) ? { value: kv.get(k) } : null), set: (k, v) => kv.set(k, v), remove: (k) => kv.delete(k) },
    CapacitorNotifications: { schedule: async (n) => { sent.push(...n); } },
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
    fetch: async (url) => {
      fetches++;
      if (url.includes('t.me/s/')) return { ok: true, text: async () => page };
      if (url.includes('er-api')) return { ok: true, json: async () => ({ rates: { TRY: 42, EUR: 0.9, SAR: 3.75, AED: 3.67, KWD: 0.307, JOD: 0.709 } }) };
      if (url.includes('gold-api')) return { ok: true, json: async () => ({ price: 3900 }) };
      throw new Error('unexpected ' + url);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const fire = (ev, args) => new Promise((res, rej) => handlers[ev](res, rej, args));
  const kvJ = (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null);
  return { kv, kvJ, sent, fire, get fetches() { return fetches; } };
}

let n = 0;
const ok = (name) => { n++; console.log('  ✓', name); };

// 07:30 دمشق = 04:30Z. الموعد 09:00 → داخل نافذة التجهيز (ساعتين قبل)
{
  const e = makeEnv({ nowIso: '2026-11-13T05:30:00Z' }); // 08:30 دمشق
  await e.fire('configure', { enabled: true, time: '09:00', channels: ['a'], mode: 'buy', goldCur: 'SYP' });
  await e.fire('dailyCheck');
  const mb = e.kvJ('morningBody');
  assert.ok(mb && mb.body.includes('146'), 'نص الصباح مجهّز');
  assert.ok(!/\u{1F1F9}\u{1F1F7}|\u{1F1FA}\u{1F1F8}/u.test(mb.body), 'بدون إيموجي أعلام');
  assert.equal(e.kvJ('preparedKey'), '2026-11-13|09:00');
  assert.equal(e.sent.length, 0, 'الـ runner ما بيبعت الإشعار الصباحي بنفسه');
  ok('قبل الموعد بنص ساعة: يجهّز النص بس (المنبّه الأصلي بيبعته)');
  const f = e.fetches;
  await e.fire('dailyCheck');
  assert.equal(e.fetches, f, 'ما بيجلب مرة تانية بنفس اليوم');
  ok('ما بيعيد التجهيز بنفس اليوم');
}
{
  const e = makeEnv({ nowIso: '2026-11-13T03:00:00Z' }); // 06:00 دمشق: قبل النافذة
  await e.fire('configure', { enabled: true, time: '09:00', channels: ['a'] });
  await e.fire('dailyCheck');
  assert.equal(e.fetches, 0);
  ok('قبل النافذة بثلاث ساعات: ما بيعمل شي');
}
{
  const e = makeEnv({ nowIso: '2026-11-13T07:00:00Z' }); // 10:00 دمشق: بعد الموعد
  await e.fire('configure', { enabled: true, time: '09:00', channels: ['a'] });
  await e.fire('dailyCheck');
  assert.equal(e.fetches, 0);
  ok('بعد الموعد: ما بيعمل شي');
}
{
  const e = makeEnv({ nowIso: '2026-11-13T21:30:00Z' }); // 00:30 دمشق، الموعد 01:00
  await e.fire('configure', { enabled: true, time: '01:00', channels: ['a'] });
  await e.fire('dailyCheck');
  assert.equal(e.kvJ('preparedKey'), '2026-11-14|01:00');
  ok('موعد بعد نص الليل: يوم دمشق صحيح');
}
// تنبيه السعر
{
  const e = makeEnv({ nowIso: '2026-11-13T10:00:00Z', usd: [150, 151] });
  await e.fire('configure', { enabled: false, channels: ['a'], mode: 'sell', alert: { enabled: true, dir: 'above', value: 150 } });
  await e.fire('dailyCheck');
  assert.equal(e.sent.length, 1);
  assert.match(e.sent[0].body, /151/);
  assert.match(e.sent[0].body, /فوق/);
  ok('تنبيه "فوق 150" انبعت لما المبيع 151');
  await e.fire('dailyCheck');
  await e.fire('alertNow');
  assert.equal(e.sent.length, 1);
  ok('ما بيتكرر لنفس القيمة');
  await e.fire('configure', { alert: { enabled: true, dir: 'above', value: 160 } });
  await e.fire('alertNow');
  assert.equal(e.sent.length, 1);
  ok('قيمة جديدة 160 ما وصلها السعر: ما في إشعار');
}
{
  const e = makeEnv({ nowIso: '2026-11-13T10:00:00Z', usd: [146, 147] });
  await e.fire('configure', { channels: ['a'], mode: 'buy', alert: { enabled: true, dir: 'below', value: 145 } });
  await e.fire('alertNow');
  assert.equal(e.sent.length, 0);
  ok('تنبيه "تحت 145" ما انبعت لما السعر 146');
}
// الويدجت
{
  const e = makeEnv({ nowIso: '2026-11-13T10:00:00Z' });
  await e.fire('configure', { channels: ['a'] });
  await e.fire('dailyCheck');
  assert.equal(e.fetches, 0);
  e.kv.set('widgetOn', 'true'); // متل ما بيكتبها RatesWidget.java
  await e.fire('dailyCheck');
  assert.ok(e.fetches > 0 && e.kvJ('lastRates').usd_syp.buy === 146);
  ok('في ويدجت: بيحدّث lastRates بالخلفية');
}
// زر التجربة
{
  const e = makeEnv({ nowIso: '2026-11-13T10:00:00Z' });
  await e.fire('configure', { channels: ['a'], goldCur: 'USD' });
  await e.fire('prepareNow');
  assert.match(e.kvJ('morningBody').body, /غرام عيار 21: \$/);
  ok('prepareNow يجهّز النص بعملة الذهب المختارة');
}
// عدة أوقات باليوم
{
  const e = makeEnv({ nowIso: '2026-11-13T10:30:00Z' }); // 13:30 دمشق
  await e.fire('configure', { enabled: true, times: ['09:00', '14:00', '20:00'], channels: ['a'] });
  await e.fire('dailyCheck');
  assert.equal(e.kvJ('preparedKey'), '2026-11-13|14:00');
  ok('3 أوقات: قبل موعد 14:00 بنص ساعة بيجهّز نص 14:00');
}
// الإشعار بيعرض بس العملات المفعّلة وبالترتيب
{
  const e = makeEnv({ nowIso: '2026-11-13T10:00:00Z' });
  await e.fire('configure', { channels: ['a'], order: ['TRY', 'USD'], goldCur: 'SYP' });
  await e.fire('prepareNow');
  const body = e.kvJ('morningBody').body, b = body.split('\n');
  assert.match(b[0], /التركي/); assert.match(b[1], /الدولار/);
  assert.ok(!/غرام/.test(body), 'الذهب مخفي');
  ok('الإشعار: التركي قبل الدولار، والذهب مخفي لأنه مو مفعّل');
}
// عند تغيّر السعر أكتر من 1% وبحد أقصى كل ساعتين
{
  const e = makeEnv({ nowIso: '2026-11-13T10:00:00Z', usd: [146, 147] });
  await e.fire('configure', { channels: ['a'], mode: 'sell', change: { enabled: true, pct: 1, minHours: 2 } });
  await e.fire('alertNow');
  assert.equal(e.sent.length, 0, 'أول مرة بس أساس');
  const e2 = makeEnv({ nowIso: '2026-11-13T10:20:00Z', usd: [148.5, 149.5] }); // +1.7%
  for (const [k, v] of e.kv) e2.kv.set(k, v);
  await e2.fire('alertNow');
  assert.equal(e2.sent.length, 1);
  assert.match(e2.sent[0].body, /▲ الدولار \+1\.7%/);
  const e3 = makeEnv({ nowIso: '2026-11-13T10:40:00Z', usd: [151, 152] });
  for (const [k, v] of e2.kv) e3.kv.set(k, v);
  e3.kv.set('changeAt', JSON.stringify(Date.parse('2026-11-13T10:20:00Z')));
  await e3.fire('alertNow');
  assert.equal(e3.sent.length, 0, 'ما في إشعار قبل ساعتين');
  ok('تغيّر 1.7% → إشعار، وتغيّر تاني قبل ساعتين → لا');
  const e4 = makeEnv({ nowIso: '2026-11-13T12:30:00Z', usd: [146.2, 147.3] });
  await e4.fire('configure', { channels: ['a'], mode: 'sell', change: { enabled: true, pct: 1 } });
  e4.kv.set('changeBase', JSON.stringify({ USD: 147 }));
  await e4.fire('alertNow');
  assert.equal(e4.sent.length, 0);
  ok('تغيّر 0.2% أقل من النسبة → ما في إشعار');
}
console.log(`\n✓ ${n} اختبار للـ runner نجح`);
