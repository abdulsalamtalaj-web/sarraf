// اختبارات المحلّل على نشرات عيّنة بصيغ مختلفة (بدون إنترنت)
// التشغيل: node test/samples.test.mjs
import assert from 'node:assert/strict';
import { parseBulletin, parseNumber, parseChannelPage } from '../src/parser.js';
import { buildRates } from '../src/rates.js';

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n').join('\n      ')); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n').join('\n      ')); }
}

// ---------- parseNumber ----------
console.log('\nparseNumber:');
const NUMS = [
  ['11.650', 11650], ['1.450.000', 1450000], ['116.5', 116.5], ['146.75', 146.75],
  ['14,700', 14700], ['146,90', 146.9], ['١٤٬٧٠٠', 14700], ['١٤٦٫٩٠ ل.س', 146.9],
  ['1,450,000', 1450000], ['1.450,5', 1450.5], ['0.024', 0.024], ['2.9', 2.9], ['147', 147],
  ['السعر: ١١٫٦٥٠ ل.س', 11650], ['$3872.23', 3872.23],
];
for (const [s, v] of NUMS) check(`"${s}" → ${v}`, () => assert.equal(parseNumber(s), v));

// ---------- 24 نشرة عيّنة ----------
// كل عينة: [الوصف، النص، المتوقع (بالليرة الجديدة)، مدينة متوقعة اختيارياً]
const S = [
  ['1. صيغة exchange_Currencyy الحقيقية',
    `🇸🇾 أسعار صرف العملات في سوريا\n━━━━━━━━━━━━━━━━━━\n🇺🇸 الليرة السورية مقابل الدولار\n🟢 شراء: 146.75 ل.س\n🔴 مبيع: 147.25 ل.س\n\n🇹🇷 الليرة السورية مقابل الليرة التركية\n🟢 شراء: 2.9 ل.س\n🔴 مبيع: 2.93 ل.س\n\n🇪🇺 الليرة السورية مقابل اليورو\n🟢 شراء: 161 ل.س\n🔴 مبيع: 162.8 ل.س\n━━━━━━━━━━━━━━━━━━\n🕒 تحديث المصدر: ١٢/١١/٢٠٢٦، ٧:٢٧ م`,
    { usd_syp: { buy: 146.75, sell: 147.25 }, try_syp: { buy: 2.9, sell: 2.93 }, eur_syp: { buy: 161, sell: 162.8 } }],
  ['2. عنوان "الدولار" بدون كلمة سوري',
    `الدولار\nشراء 146.5\nمبيع 147`,
    { usd_syp: { buy: 146.5, sell: 147 } }],
  ['3. "الدولار الأمريكي" + التركي + اليورو بدون سوري',
    `💵 الدولار الأمريكي\nشراء: 146\nمبيع: 147\n\n🇹🇷 التركي\nشراء: 3.40\nمبيع: 3.50\n\n💶 اليورو\nشراء: 160\nمبيع: 162`,
    { usd_syp: { buy: 146, sell: 147 }, try_syp: { buy: 3.4, sell: 3.5 }, eur_syp: { buy: 160, sell: 162 } }],
  ['4. أرقام عربية بالكامل',
    `الدولار مقابل الليرة السورية\nالشراء: ١٤٦٫٥٠\nالمبيع: ١٤٧٫٢٥`,
    { usd_syp: { buy: 146.5, sell: 147.25 } }],
  ['5. ليرة قديمة بفاصلة آلاف',
    `الدولار مقابل الليرة السورية\nشراء: 14,650\nمبيع: 14,725`,
    { usd_syp: { buy: 146.5, sell: 147.25 } }],
  ['6. ليرة قديمة بنقطة آلاف (11.650)',
    `سعر الدولار في دمشق\nشراء 11.650\nمبيع 11.750`,
    { usd_syp: { buy: 116.5, sell: 117.5 } }],
  ['7. المبيع قبل الشراء',
    `🇺🇸 الدولار\n🔴 مبيع: 147.25\n🟢 شراء: 146.75`,
    { usd_syp: { buy: 146.75, sell: 147.25 } }],
  ['8. سطر واحد مع / (الصيغة السطرية)',
    `الدولار مقابل الليرة السورية / الشراء ١٤٬٦٩٠ / المبيع ١٤٬٧٥٠\nالليرة التركية مقابل الدولار / الشراء 42.10 / المبيع 42.30\nالليرة التركية مقابل الليرة السورية / الشراء 345 / المبيع 350\nاليورو مقابل الليرة السورية / الشراء 16,100 / المبيع 16,300`,
    { usd_syp: { buy: 146.9, sell: 147.5 }, try_usd: { buy: 42.1, sell: 42.3 }, try_syp: { buy: 3.45, sell: 3.5 }, eur_syp: { buy: 161, sell: 163 } }],
  ['9. السعر على نفس سطر العنوان',
    `الدولار شراء 146.9 مبيع 147.4`,
    { usd_syp: { buy: 146.9, sell: 147.4 } }],
  ['10. رقمان بدون كلمة شراء/مبيع',
    `أسعار اليوم\nالدولار: 146.5 - 147.5\nالتركي: 3.4 - 3.5`,
    { usd_syp: { buy: 146.5, sell: 147.5 }, try_syp: { buy: 3.4, sell: 3.5 } }],
  ['11. مدن: دمشق/حلب/إدلب (أقسام)',
    `📍 دمشق\nالدولار شراء 146.5 مبيع 147\n📍 حلب\nالدولار شراء 147 مبيع 147.5\n📍 إدلب\nالدولار شراء 148 مبيع 148.5`,
    { usd_syp: { buy: 146.5, sell: 147 } }, 'damascus'],
  ['12. مدن على نفس السطر تحت عنوان الدولار، دمشق ليست الأولى',
    `💵 الدولار\nحلب: شراء 14,800 مبيع 14,850\nدمشق: شراء 14,700 مبيع 14,750\nإدلب: شراء 14,900 مبيع 14,950`,
    { usd_syp: { buy: 147, sell: 147.5 } }, 'damascus'],
  ['13. مدن بدون دمشق → أول مدينة صالحة (لا null)',
    `💵 الدولار\nحلب: شراء 147 مبيع 147.5\nإدلب: شراء 148 مبيع 148.5`,
    { usd_syp: { buy: 147, sell: 147.5 } }, 'aleppo'],
  ['14. مدن برقمين بدون كلمات',
    `الدولار\nدمشق 11.650 / 11.700\nحلب 11.700 / 11.750`,
    { usd_syp: { buy: 116.5, sell: 117 } }, 'damascus'],
  ['15. الشراء أكبر من المبيع → الزوج مرفوض',
    `الدولار\nشراء 148\nمبيع 147`,
    null],
  ['16. التركي فيه شراء > مبيع → يُحذف التركي وحده',
    `الدولار\nشراء 146\nمبيع 147\nالتركي\nشراء 3.6\nمبيع 3.5`,
    { usd_syp: { buy: 146, sell: 147 } }],
  ['17. رسالة ذهب فيها "الريال مقابل الدولار" ليست نشرة دولار',
    `📊 أسعار الذهب\n🥇 الذهب بالدولار\nعيار 21: $109\n\n💶 اليورو مقابل الدولار\n🟢 شراء: $1.09\n🔴 مبيع: $1.11\n\n🇸🇦 الريال السعودي مقابل الدولار\n🟢 شراء: $0.26\n🔴 مبيع: $0.27`,
    null],
  ['18. خبر عادي فيه رقم وكلمة الدولار',
    `🤔 بدء وصول رواتب وزارة الدفاع والدولار نزل 2%`,
    null],
  ['19. الإنجليزية BUY/SELL',
    `USD/SYP\nBuy: 146.5\nSell: 147.0`,
    { usd_syp: { buy: 146.5, sell: 147 } }],
  ['20. التركي مقابل الدولار معكوس (0.024)',
    `الدولار\nشراء 146\nمبيع 147\nالليرة التركية مقابل الدولار\nشراء 0.0236\nمبيع 0.0238`,
    { usd_syp: { buy: 146, sell: 147 }, try_usd: { buy: 42.0168, sell: 42.3729 } }],
  ['21. إيموجي أعلام بدل الأسماء',
    `🇺🇸\nشراء: 146.25\nمبيع: 146.75\n🇹🇷\nشراء: 3.45\nمبيع: 3.5`,
    { usd_syp: { buy: 146.25, sell: 146.75 }, try_syp: { buy: 3.45, sell: 3.5 } }],
  ['22. ليرة قديمة وجديدة معاً (القديم بالأول)',
    `الدولار بالليرة القديمة\nشراء 14,650 مبيع 14,700\nبالليرة الجديدة\nشراء 146.5 مبيع 147`,
    { usd_syp: { buy: 146.5, sell: 147 } }],
  ['23. يورو قديم بنقطة آلاف + تركي قديم',
    `الدولار\nشراء: 14.650\nمبيع: 14.700\nاليورو\nشراء: 16.100\nمبيع: 16.250\nالتركي\nشراء: 345\nمبيع: 350`,
    { usd_syp: { buy: 146.5, sell: 147 }, eur_syp: { buy: 161, sell: 162.5 }, try_syp: { buy: 3.45, sell: 3.5 } }],
  ['24. فاصل | وإيموجي كثيرة',
    `🔥🔥 نشرة الصباح 🔥🔥\n💵 الدولار | 🟢 شراء 146.5 | 🔴 مبيع 147`,
    { usd_syp: { buy: 146.5, sell: 147 } }],
  ['25. سعر شاذ (الدولار 3 ليرات) → مرفوض',
    `الدولار\nشراء 3\nمبيع 4`,
    null],
];

console.log('\nنشرات عيّنة:');
for (const [name, text, expected, city] of S) {
  check(name, () => {
    const r = parseBulletin(text);
    if (expected === null) return assert.equal(r, null);
    assert.ok(r, 'رجعت null');
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(r[k], v, k);
    if (city) assert.equal(r.city, city);
  });
}

// ---------- منطق القناتين ----------
console.log('\nمنطق القناتين والفحص المنطقي:');
const page = (...msgs) => msgs.map(([t, txt], i) =>
  `<div class="tgme_widget_message_wrap" data-post="c/${i}"><time datetime="${t}"></time><div class="tgme_widget_message_text">${txt.replace(/\n/g, '<br>')}</div></div>`).join('');
const usdMsg = (b, s) => `الدولار\nشراء ${b}\nمبيع ${s}`;
const fx = async () => ({ TRY: 42, EUR: 0.9, SAR: 3.75, AED: 3.6725, KWD: 0.307, JOD: 0.709 });
const noGold = async () => 3900;

await checkAsync('القناتان متفقتان → بدون تنبيه، والحوالات محسوبة', async () => {
  const pages = { a: page(['2026-11-13T07:00:00Z', usdMsg(146, 147)]), b: page(['2026-11-13T07:00:00Z', usdMsg(146.5, 147.2)]) };
  const r = await buildRates(['a', 'b'], async (c) => pages[c], fx, { fetchGoldOunce: noGold });
  assert.equal(r.source, 'a');
  assert.equal(r.disagree, null);
  assert.deepEqual(r.remit.sar_syp, { buy: 38.9333, sell: 39.2, per_usd: 3.75 });
  assert.ok(r.remit.kwd_syp.buy > 400);
});
await checkAsync('فرق أكبر من 2% → disagree مع السعرين', async () => {
  const pages = { a: page(['2026-11-13T07:00:00Z', usdMsg(146, 147)]), b: page(['2026-11-13T07:00:00Z', usdMsg(151, 152)]) };
  const r = await buildRates(['a', 'b'], async (c) => pages[c], fx, { fetchGoldOunce: noGold });
  assert.ok(r.disagree);
  assert.equal(r.disagree.values.length, 2);
  assert.deepEqual(r.disagree.values[1].usd_syp, { buy: 151, sell: 152 });
});
await checkAsync('قفزة 20% بدون تأكيد → مرفوضة', async () => {
  const pages = { a: page(['2026-11-13T07:00:00Z', usdMsg(176, 177)]), b: '' };
  const r = await buildRates(['a', 'b'], async (c) => pages[c], fx, { fetchGoldOunce: noGold, last: { usd_syp: { buy: 146, sell: 147 } } });
  assert.ok(r.error);
  assert.equal(r.rejected[0].channel, 'a');
});
await checkAsync('قفزة 20% أكّدتها القناة التانية → مقبولة', async () => {
  const pages = { a: page(['2026-11-13T07:00:00Z', usdMsg(176, 177)]), b: page(['2026-11-13T07:00:00Z', usdMsg(176.5, 177.5)]) };
  const r = await buildRates(['a', 'b'], async (c) => pages[c], fx, { fetchGoldOunce: noGold, last: { usd_syp: { buy: 146, sell: 147 } } });
  assert.ok(!r.error);
  assert.equal(r.confirmed_by, 'b');
});
await checkAsync('القناة الأولى قفزة مرفوضة والتانية طبيعية → تُستخدم التانية', async () => {
  const pages = { a: page(['2026-11-13T07:00:00Z', usdMsg(1460, 1470)]), b: page(['2026-11-13T07:00:00Z', usdMsg(146.5, 147)]) };
  const r = await buildRates(['a', 'b'], async (c) => pages[c], fx, { fetchGoldOunce: noGold, last: { usd_syp: { buy: 146, sell: 147 } } });
  assert.equal(r.source, 'b');
  assert.equal(r.rejected[0].channel, 'a');
});
await checkAsync('قفزة مؤكدة بنشرتين متتاليتين بنفس القناة (القناة التانية معطلة) → مقبولة', async () => {
  const pages = { a: page(['2026-11-13T06:00:00Z', usdMsg(175, 176)], ['2026-11-13T07:00:00Z', usdMsg(176, 177)]) };
  const r = await buildRates(['a', 'b'], async (c) => { if (!pages[c]) throw new Error('down'); return pages[c]; }, fx, { fetchGoldOunce: noGold, last: { usd_syp: { buy: 146, sell: 147 } } });
  assert.ok(!r.error, r.error);
  assert.match(r.confirmed_by, /نشرتين/);
});
await checkAsync('أحدث نشرة مع النشرة السابقة', async () => {
  const p = parseChannelPage(page(['2026-11-13T06:00:00Z', usdMsg(145, 146)], ['2026-11-13T07:00:00Z', 'خبر'], ['2026-11-13T08:00:00Z', usdMsg(146, 147)]));
  assert.deepEqual(p.usd_syp, { buy: 146, sell: 147 });
  assert.deepEqual(p.previous.usd_syp, { buy: 145, sell: 146 });
});

console.log(`\n${failed ? '✗' : '✓'} ${passed} نجح، ${failed} فشل (منها ${S.length} نشرة عيّنة)`);
if (failed) process.exit(1);
