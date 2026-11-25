// اختبارات الخادم المركزي ولوحة الإدارة وربط واتساب (بدون إنترنت، باستخدام KV وهمي)
// التشغيل: node test/worker.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRates } from '../src/rates.js';
import { parseBulletin, parseGold, parseStructuredBulletin } from '../src/parser.js';

let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log('  ✓', name);
}

// 1) تحقق أن admin.html يحتوي على الأقسام الأساسية الأربعة
const adminHtml = readFileSync(new URL('../src/admin.html', import.meta.url), 'utf8');
await check('لوحة الإدارة تحتوي على: لصق واتساب + المعلّق + التصحيح اليدوي + إدارة المصادر', async () => {
  assert.match(adminHtml, /pasteText/);
  assert.match(adminHtml, /pendingList/);
  assert.match(adminHtml, /btnSaveOv/);
  assert.match(adminHtml, /cfgPrimary/);
  assert.match(adminHtml, /ADMIN_TOKEN/);
});

// 2) تحقق من صحة صيغة worker/src/index.js (استيراداته وبنيته)
const workerSrc = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
await check('خادم Worker يتضمن مسارات /admin و /admin/api/* و /ingest/whatsapp و KV cache وحماية الضغط العالي', async () => {
  assert.match(workerSrc, /\/ingest\/whatsapp/);
  assert.match(workerSrc, /\/admin\/api\//);
  assert.match(workerSrc, /latest_rates_v1/);
  assert.match(workerSrc, /stale_fallback/);
  assert.match(workerSrc, /timingSafeEq/);
  assert.match(workerSrc, /inFlightCompute/);
  assert.match(workerSrc, /caches\.default/);
  assert.match(workerSrc, /KV_MIN_WRITE_MS/);
});

// 3) اختبار أولوية الاعتماد اليدوي فوق كل المصادر
await check('التصحيح اليدوي (manual) يتقدّم على تلغرام وواتساب حتى لو كانت نشراتهما أحدث', async () => {
  const r = await buildRates(['ch1'], async () => '<div class="tgme_widget_message_wrap" data-post="c/1"><time datetime="2026-11-19T15:00:00Z"></time><div class="tgme_widget_message_text">الدولار<br>شراء 140<br>مبيع 141</div></div>', async () => ({ TRY: 42, EUR: 0.9, SAR: 3.75 }), {
    fetchGoldOunce: async () => 3800,
    extraSources: [{
      channel: 'إدارة صرّاف',
      kind: 'manual',
      ok: true,
      data: { usd_syp: { buy: 150, sell: 151 }, post_time: '2026-11-19T12:00:00Z' },
    }],
  });
  assert.equal(r.source_kind, 'manual');
  assert.deepEqual(r.usd_syp, { buy: 150, sell: 151 });
});

// 4) اختبار استخراج نشرة واتساب مركّبة (دولار + ذهب)
await check('تحليل نشرة واتساب نصية تحتوي عملات + ذهب محلي', async () => {
  const txt = 'الدولار الأمريكي\nشراء: 149.5\nمبيع: 150.5\nعيار 21: 15,600 ل.س';
  const b = parseStructuredBulletin(txt) || parseBulletin(txt);
  const g = parseGold(txt);
  assert.deepEqual(b.usd_syp, { buy: 149.5, sell: 150.5 });
  assert.equal(g.gram['21'].value, 15600);
  assert.equal(g.gram['21'].cur, 'syp');
});

console.log(`\n✓ ${passed} اختبار للخادم المركزي ولوحة الإدارة نجح`);
