// Cloudflare Worker لتطبيق "صرّاف"
//   /rates    الأسعار (عملات + ذهب + حوالات) — كاش 60 ثانية
//   /content  محتوى البطاقة الطبية وفيديو الأسبوع (من content.json)
//   /history  سعر الدولار وغرام 21 لآخر 30 يوم (?days=7 أو 30) — لقطة كل ساعة بـ KV
//   /privacy  سياسة الخصوصية (رابط لمتجر Google Play)
//   /update   آخر إصدار (APK + حزمة الواجهة للتحديث الهوائي + إعدادات عن بعد) من update.json
//   /get      رابط تحميل ثابت: بيحوّل لـ DOWNLOAD_URL (ميديا فاير أو GitHub أو غيره)
//   /ota/*    حزم الواجهة (ملفات ثابتة من مجلد public/)
// اللقطة الساعية تُخزّن عبر Cron Trigger (انظر wrangler.toml)
import { buildRates, DEFAULTS, list } from './rates.js';
import CONTENT from '../content.json';
import PRIVACY from '../privacy.html';
import UPDATE from '../update.json';

const CACHE_SECONDS = 60;
const HISTORY_DAYS = 30;
const HISTORY_KEY = 'history_v1';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
      ...CORS,
      ...extra,
    },
  });
}

async function readHistory(env) {
  if (!env.HISTORY) return [];
  try { return (await env.HISTORY.get(HISTORY_KEY, 'json')) || []; } catch { return []; }
}

function ratesOpts(env, last) {
  return {
    GOLD_CHANNELS: env.GOLD_CHANNELS || '',
    GOLD_API: env.GOLD_API || DEFAULTS.GOLD_API,
    FX_API: env.FX_API || DEFAULTS.FX_API,
    last,
  };
}

// آخر سعر محفوظ (للفحص المنطقي: رفض القفزات > 10%)
async function lastSaved(env) {
  const h = await readHistory(env);
  const p = h[h.length - 1];
  return p ? { usd_syp: { buy: p.usd_buy, sell: p.usd_sell } } : null;
}

// لقطة ساعية: تُضاف للسجل وتُحذف اللقطات الأقدم من 30 يوم
export async function snapshot(env, now = Date.now()) {
  if (!env.HISTORY) throw new Error('KV binding HISTORY غير معرّف');
  const channels = list(env.CHANNELS || DEFAULTS.CHANNELS);
  const r = await buildRates(channels, null, null, ratesOpts(env, await lastSaved(env)));
  if (r.error) return { ok: false, error: r.error };
  const g21usd = r.gold?.usd?.['21'] ?? null;
  const point = {
    t: new Date(now).toISOString(),
    usd_buy: r.usd_syp.buy,
    usd_sell: r.usd_syp.sell,
    g21_usd: g21usd,
    g21_syp: r.gold?.syp?.['21'] ?? (g21usd ? Math.round(g21usd * r.usd_syp.sell * 100) / 100 : null),
  };
  const cutoff = now - HISTORY_DAYS * 86400e3;
  const h = (await readHistory(env)).filter((p) => Date.parse(p.t) >= cutoff);
  // لقطة وحدة بالساعة كحد أقصى
  if (h.length && h[h.length - 1].t.slice(0, 13) === point.t.slice(0, 13)) h[h.length - 1] = point;
  else h.push(point);
  await env.HISTORY.put(HISTORY_KEY, JSON.stringify(h));
  return { ok: true, point, count: h.length };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);

    if (url.pathname === '/content') return json(CONTENT, 200, { 'Cache-Control': 'public, max-age=300' });

    if (url.pathname === '/privacy') {
      return new Response(PRIVACY, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
    }

    if (url.pathname === '/update') {
      // رابط الحزمة نسبي → مطلق؛ ورابط تحميل الـ APK = /get الثابت
      const u = JSON.parse(JSON.stringify(UPDATE));
      if (u.web?.url && u.web.url.startsWith('/')) u.web.url = url.origin + u.web.url;
      if (u.apk) u.apk.url = url.origin + '/get';
      u.download_url = url.origin + '/get';
      return json(u, 200, { 'Cache-Control': 'public, max-age=300' });
    }

    if (url.pathname === '/get') {
      const target = env.DOWNLOAD_URL || '';
      if (target) return Response.redirect(target, 302);
      return new Response('<meta charset=utf-8><body style="font:18px system-ui;background:#0A1410;color:#EEF4F0;text-align:center;padding:48px 16px" dir=rtl><h2 style="color:#F5C542">صرّاف</h2><p>رابط التحميل رح يكون جاهز قريباً.</p></body>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/history') {
      const days = Math.min(HISTORY_DAYS, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
      const cutoff = Date.now() - days * 86400e3;
      const points = (await readHistory(env)).filter((p) => Date.parse(p.t) >= cutoff);
      return json({ days, points }, 200, { 'Cache-Control': 'public, max-age=600' });
    }

    if (url.pathname !== '/' && url.pathname !== '/rates') return json({ error: 'not found' }, 404);

    const cache = caches.default;
    const cacheKey = new Request(new URL('/rates', url.origin).toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return hit;

    const channels = list(env.CHANNELS || DEFAULTS.CHANNELS);
    const body = await buildRates(channels, null, null, ratesOpts(env, await lastSaved(env)));
    if (body.error) return json(body, 502, { 'Cache-Control': 'no-store' });

    const res = json(body);
    ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
    // أول تشغيل: إذا السجل فاضي نخزّن لقطة فوراً بدل ما ننطر الساعة
    if (env.HISTORY) ctx.waitUntil(readHistory(env).then((h) => (h.length ? null : snapshot(env))).catch(() => {}));
    return res;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(snapshot(env, event.scheduledTime).then((r) => console.log('snapshot', JSON.stringify(r))));
  },
};
