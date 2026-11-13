// اختبار المحلّل على صفحات القنوات الحقيقية + حالات صيغ مختلفة
// التشغيل: node test/test.mjs  (من داخل مجلد worker)
import assert from 'node:assert/strict';
import { parseBulletin, parseNumber, parseGold } from '../src/parser.js';
import { buildRates } from '../src/rates.js';

// 1) أرقام عربية وفواصل
assert.equal(parseNumber('١٤٬٧٠٠'), 14700);
assert.equal(parseNumber('146,90'), 146.9);
assert.equal(parseNumber('١٤٦٫٩٠ ل.س'), 146.9);
assert.equal(parseNumber('14,700'), 14700);

// 2) الصيغة السطرية المذكورة في الطلب + ليرة قديمة بالآلاف
const inline = parseBulletin(
  'الدولار مقابل الليرة السورية / الشراء ١٤٬٦٩٠ / المبيع ١٤٬٧٥٠\n' +
  'الليرة التركية مقابل الدولار / الشراء 42.10 / المبيع 42.30\n' +
  'الليرة التركية مقابل الليرة السورية / الشراء 345 / المبيع 350\n' +
  'اليورو مقابل الليرة السورية / الشراء 16,100 / المبيع 16,300',
);
assert.deepEqual(inline.usd_syp, { buy: 146.9, sell: 147.5 });
assert.deepEqual(inline.try_syp, { buy: 3.45, sell: 3.5 });
assert.deepEqual(inline.eur_syp, { buy: 161, sell: 163 });
assert.deepEqual(inline.try_usd, { buy: 42.1, sell: 42.3 });

// 3) الذهب: صيغة القناة (بالدولار) وصيغة محلية بالليرة
const g1 = parseGold('🥇 الذهب بالدولار\nأونصة الذهب: &#036;3941.85\nعيار 21: $111\nعيار 18: $95'.replace('&#036;', '$'));
assert.equal(g1.ounce_usd, 3941.85);
assert.deepEqual(g1.gram['21'], { value: 111, cur: 'usd' });
const g2 = parseGold('أسعار الذهب\nغرام عيار ٢١: ١٬٦٣٠٬٠٠٠ ل.س\nالليرة الذهب: 13,040,000 ل.س');
assert.deepEqual(g2.gram['21'], { value: 1630000, cur: 'syp' });
assert.equal(g2.lira.cur, 'syp');
assert.equal(parseGold('🇺🇸 الليرة السورية مقابل الدولار\n🟢 شراء: 146.5 ل.س'), null);

// ذهب محلي بالليرة القديمة → يتحول للجديدة ويُعتبر غير تقديري
const local = await buildRates(['x'], async () =>
  `<div class="tgme_widget_message_wrap"><time datetime="2026-11-13T07:00:00+00:00"></time><div class="tgme_widget_message_text">الليرة السورية مقابل الدولار<br>شراء: 146.5<br>مبيع: 147</div></div>` +
  `<div class="tgme_widget_message_wrap"><time datetime="2026-11-13T08:00:00+00:00"></time><div class="tgme_widget_message_text">الذهب<br>أونصة الذهب: $3900<br>غرام عيار 21: 1,630,000 ل.س</div></div>`,
  async () => ({ TRY: 42, EUR: 0.9 }));
assert.equal(local.gold.syp['21'], 16300);
assert.equal(local.gold.estimated, false);
console.log('✓ اختبارات الصيغ الاصطناعية نجحت');

// 4) القنوات الحقيقية
const fetchPage = async (ch) => {
  const r = await fetch(`https://t.me/s/${ch}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return r.text();
};
const fetchFx = async () => (await (await fetch('https://open.er-api.com/v6/latest/USD')).json()).rates;

for (const chs of [['exchange_Currencyy', 'aboothman33'], ['aboothman33', 'exchange_Currencyy']]) {
  const out = await buildRates(chs, fetchPage, fetchFx);
  console.log(`\n=== القنوات: ${chs.join(' → ')}`);
  console.log(JSON.stringify(out, null, 2));
  assert.ok(!out.error, 'يجب أن ينجح الجلب');
  assert.ok(out.usd_syp.buy > 50 && out.usd_syp.buy < 1000, 'سعر الدولار بالليرة الجديدة');
  assert.ok(out.gold && out.gold.usd['21'] > 20, 'سعر غرام الذهب');
}
console.log('\n✓ الاختبار على الصفحات الحقيقية نجح');
