// Cloudflare Worker المركزي لتطبيق "صرّاف" (مجاني 100% — بدون حاسوب)
//   GET  /rates            الأسعار الموحّدة والمفحوصة (عملات + ذهب + حوالات + مصادر وتوقيت مستقل)
//   GET  /history          سعر الدولار وغرام 21 لآخر 30 يوم (?days=7 أو 30)
//   GET  /content          محتوى البطاقة الطبية وفيديو الأسبوع
//   GET  /privacy          سياسة الخصوصية
//   GET  /update           آخر إصدار وإعدادات القنوات عن بعد
//   GET  /get              رابط تحميل ثابت
//   GET  /admin            لوحة إدارة صغيرة (محمية بـ ADMIN_TOKEN)
//   POST /admin/api/*      عمليات الإدارة (لصق نشرة واتساب، تصحيح يدوي، تعطيل/ترتيب المصادر، اعتماد المعلّق)
//   GET|POST /ingest/whatsapp   استقبال نشرات واتساب (Webhook رسمي أو دفع موثّق بـ INGEST_TOKEN)
import { buildRates, DEFAULTS, JUMP_LIMIT, list } from './rates.js';
import { parseBulletin, parseGold, parseStructuredBulletin } from './parser.js';
import CONTENT from '../content.json';
import PRIVACY from '../privacy.html';
import UPDATE from '../update.json';
import ADMIN_HTML from './admin.html';

const CACHE_SECONDS = 60;
const KV_FRESH_MS = 5 * 60 * 1000;   // نعيد استخدام آخر نشرة محفوظة في KV لـ 5 دقائق
const MEM_FRESH_MS = 45 * 1000;      // كاش بالذاكرة يعمل حتى على workers.dev
const HISTORY_DAYS = 30;
const KEYS = {
  history: 'history_v1',
  latest: 'latest_rates_v1',
  config: 'admin_config_v1',
  override: 'admin_override_v1',
  waLatest: 'whatsapp_latest_v1',
  pending: 'pending_v1',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

let memCache = null;

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

async function kvGet(env, key, fallback = null) {
  if (!env.HISTORY) return fallback;
  try { const v = await env.HISTORY.get(key, 'json'); return v ?? fallback; } catch { return fallback; }
}
async function kvPut(env, key, val) {
  if (!env.HISTORY) return;
  await env.HISTORY.put(key, JSON.stringify(val));
}
async function kvDel(env, key) {
  if (!env.HISTORY) return;
  await env.HISTORY.delete(key);
}

function timingSafeEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function checkBearer(req, secret) {
  if (!secret) return false;
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return !!(m && timingSafeEq(m[1].trim(), String(secret)));
}

async function getConfig(env) {
  const saved = await kvGet(env, KEYS.config, null);
  const envCh = list(env.CHANNELS || DEFAULTS.CHANNELS);
  return {
    primary: saved?.primary === 'whatsapp' ? 'whatsapp' : 'telegram',
    channels: Array.isArray(saved?.channels) && saved.channels.length ? saved.channels : envCh,
    disabled_channels: Array.isArray(saved?.disabled_channels) ? saved.disabled_channels : [],
    whatsapp_feed_url: saved?.whatsapp_feed_url ?? (env.WHATSAPP_FEED_URL || ''),
    auto_approve_whatsapp: !!saved?.auto_approve_whatsapp,
  };
}

async function activeOverride(env) {
  const ov = await kvGet(env, KEYS.override, null);
  if (!ov || !ov.usd_syp) return null;
  if (ov.expires_at && Date.parse(ov.expires_at) <= Date.now()) {
    await kvDel(env, KEYS.override);
    return null;
  }
  return ov;
}

// جلب تغذية واتساب الاحتياطية (مثل sarraf-whatsapp-cloud) إذا كان رابطها مضبوطاً
async function fetchWhatsappFeed(url, priority) {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Sarraf-Worker/1.0' } });
    if (!res.ok) return { channel: 'whatsapp-feed', kind: 'whatsapp', ok: false, error: `HTTP ${res.status}` };
    const d = await res.json();
    if (!d?.usd_syp?.buy || !d?.usd_syp?.sell) return { channel: 'whatsapp-feed', kind: 'whatsapp', ok: false, error: 'لا توجد أسعار صالحة' };
    return {
      channel: d.source || 'whatsapp-feed',
      kind: 'whatsapp',
      priority,
      ok: true,
      data: {
        usd_syp: d.usd_syp,
        try_syp: d.try_syp || null,
        eur_syp: d.eur_syp || null,
        try_usd: d.try_usd || null,
        city: d.city || null,
        post_time: d.post_time || d.fetched || null,
      },
      gold: d.gold || null,
    };
  } catch (e) {
    return { channel: 'whatsapp-feed', kind: 'whatsapp', ok: false, error: String(e.message || e) };
  }
}

async function readHistory(env) {
  return (await kvGet(env, KEYS.history, [])) || [];
}
async function lastSaved(env) {
  const latest = await kvGet(env, KEYS.latest, null);
  if (latest?.usd_syp) return { usd_syp: latest.usd_syp };
  const h = await readHistory(env);
  const p = h[h.length - 1];
  return p ? { usd_syp: { buy: p.usd_buy, sell: p.usd_sell } } : null;
}

function parseAnyText(text) {
  const bulletin = parseStructuredBulletin(text) || parseBulletin(text);
  const gold = parseGold(text);
  return { bulletin, gold };
}

async function pushPending(env, item) {
  const list0 = (await kvGet(env, KEYS.pending, [])) || [];
  const next = [item, ...list0.filter((x) => x.id !== item.id)].slice(0, 20);
  await kvPut(env, KEYS.pending, next);
  return next;
}

// التجميع المركزي الكامل: يدمج التصحيح اليدوي + واتساب + قنوات تلغرام مع قواعد الحداثة والفحص
export async function computeRates(env) {
  const cfg = await getConfig(env);
  const extraSources = [];
  const waPriority = cfg.primary === 'whatsapp' ? 1 : 50;

  const ov = await activeOverride(env);
  if (ov) {
    extraSources.push({
      channel: ov.source || 'إدارة صرّاف',
      kind: 'manual',
      priority: -100,
      ok: true,
      data: {
        usd_syp: ov.usd_syp,
        try_syp: ov.try_syp || null,
        eur_syp: ov.eur_syp || null,
        post_time: ov.post_time,
      },
      gold: ov.gold || null,
    });
  }

  const waPushed = await kvGet(env, KEYS.waLatest, null);
  if (waPushed?.data?.usd_syp) {
    extraSources.push({
      channel: waPushed.source || 'whatsapp',
      kind: 'whatsapp',
      priority: waPriority,
      ok: true,
      data: waPushed.data,
      gold: waPushed.gold || null,
    });
  }

  if (cfg.whatsapp_feed_url) {
    const feed = await fetchWhatsappFeed(cfg.whatsapp_feed_url, waPriority + 1);
    if (feed) extraSources.push(feed);
  }

  const activeChannels = cfg.channels.filter((ch) => !cfg.disabled_channels.includes(ch));
  const last = await lastSaved(env);
  const body = await buildRates(activeChannels, null, null, {
    GOLD_CHANNELS: env.GOLD_CHANNELS || '',
    GOLD_API: env.GOLD_API || DEFAULTS.GOLD_API,
    FX_API: env.FX_API || DEFAULTS.FX_API,
    last,
    extraSources,
  });

  // إذا رُفضت نشرات بسبب قفزة > 10% نحفظها للمراجعة في لوحة الإدارة
  if (Array.isArray(body.rejected) && body.rejected.length) {
    for (const rej of body.rejected) {
      await pushPending(env, {
        id: 'rej-' + rej.channel + '-' + (rej.post_time || Date.now()),
        source: rej.channel,
        kind: rej.kind || 'telegram',
        reason: rej.reason,
        post_time: rej.post_time || null,
        received_at: new Date().toISOString(),
        data: { usd_syp: rej.usd_syp, post_time: rej.post_time || new Date().toISOString() },
      });
    }
  }

  if (!body.error) {
    memCache = { t: Date.now(), body };
    await kvPut(env, KEYS.latest, body);
  }
  return body;
}

export async function snapshot(env, now = Date.now()) {
  const r = await computeRates(env);
  if (r.error) return { ok: false, error: r.error };
  if (!env.HISTORY) return { ok: true, point: null, count: 0 };
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
  if (h.length && h[h.length - 1].t.slice(0, 13) === point.t.slice(0, 13)) h[h.length - 1] = point;
  else h.push(point);
  await kvPut(env, KEYS.history, h);
  return { ok: true, point, count: h.length };
}

async function adminState(env) {
  return {
    config: await getConfig(env),
    rates: (await kvGet(env, KEYS.latest, null)) || memCache?.body || null,
    override: await activeOverride(env),
    pending: (await kvGet(env, KEYS.pending, [])) || [],
  };
}

async function handleWhatsappIngest(request, env, url) {
  // 1) تحقق Webhook الرسمي من Meta (WhatsApp Business Platform)
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const tok = url.searchParams.get('hub.verify_token');
    const ch = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && timingSafeEq(tok || '', env.WHATSAPP_VERIFY_TOKEN)) {
      return new Response(ch || '', { status: 200 });
    }
    return json({ error: 'forbidden' }, 403);
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const payload = await request.json().catch(() => null);
  if (!payload) return json({ error: 'invalid json' }, 400);

  let text = '', sender = '', postTime = new Date().toISOString();
  const isBearer = checkBearer(request, env.INGEST_TOKEN || env.ADMIN_TOKEN);

  if (payload.object === 'whatsapp_business_account') {
    // Webhook رسمي: نقبل فقط من الأرقام المعتمدة في WHATSAPP_ALLOWED_NUMBERS
    const msg = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return json({ ok: true, ignored: true }, 200, { 'Cache-Control': 'no-store' });
    sender = String(msg.from || '').replace(/[^\d]/g, '');
    const allowed = list(env.WHATSAPP_ALLOWED_NUMBERS || '').map((n) => n.replace(/[^\d]/g, ''));
    if (!allowed.length || !allowed.includes(sender)) return json({ error: 'sender not allowed' }, 403, { 'Cache-Control': 'no-store' });
    text = msg.text?.body || '';
    if (msg.timestamp) postTime = new Date(Number(msg.timestamp) * 1000).toISOString();
  } else if (isBearer) {
    text = String(payload.text || '');
    sender = String(payload.source || 'whatsapp-push');
    if (payload.post_time && Number.isFinite(Date.parse(payload.post_time))) postTime = new Date(payload.post_time).toISOString();
  } else {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  const { bulletin, gold } = parseAnyText(text);
  if (!bulletin?.usd_syp) return json({ ok: false, error: 'لم يُعثر على أسعار صالحة في الرسالة' }, 422, { 'Cache-Control': 'no-store' });

  const data = { ...bulletin, post_time: bulletin.post_time || postTime };
  const cfg = await getConfig(env);
  const last = await lastSaved(env);
  const lastMid = last?.usd_syp ? (last.usd_syp.buy + last.usd_syp.sell) / 2 : null;
  const curMid = (data.usd_syp.buy + data.usd_syp.sell) / 2;
  const bigJump = !!(lastMid && Math.abs(curMid - lastMid) / lastMid > JUMP_LIMIT);

  if (cfg.auto_approve_whatsapp && !bigJump) {
    await kvPut(env, KEYS.waLatest, { source: sender || 'whatsapp', data, gold: gold ? { ...gold, post_time: data.post_time } : null, updated_at: new Date().toISOString() });
    await computeRates(env);
    return json({ ok: true, approved: true, data }, 200, { 'Cache-Control': 'no-store' });
  }

  await pushPending(env, {
    id: 'wa-' + Date.now(),
    source: sender || 'whatsapp',
    kind: 'whatsapp',
    reason: bigJump ? 'قفزة أكبر من 10% (واتساب)' : 'نشرة واتساب بانتظار الاعتماد',
    post_time: data.post_time,
    received_at: new Date().toISOString(),
    raw: text.slice(0, 600),
    data,
    gold: gold ? { ...gold, post_time: data.post_time } : null,
  });
  return json({ ok: true, approved: false, pending: true, data }, 200, { 'Cache-Control': 'no-store' });
}

async function handleAdminApi(request, env, sub) {
  if (!checkBearer(request, env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  if (sub === 'state' && request.method === 'GET') return json(await adminState(env), 200, { 'Cache-Control': 'no-store' });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { 'Cache-Control': 'no-store' });
  const body = await request.json().catch(() => ({}));

  if (sub === 'parse') {
    const { bulletin, gold } = parseAnyText(body.text || '');
    return json({ ok: !!(bulletin?.usd_syp || gold), bulletin, gold }, 200, { 'Cache-Control': 'no-store' });
  }
  if (sub === 'publish-text') {
    const { bulletin, gold } = parseAnyText(body.text || '');
    if (!bulletin?.usd_syp) return json({ error: 'لم يُعثر على سعر دولار صالح في النص' }, 400, { 'Cache-Control': 'no-store' });
    const nowIso = new Date().toISOString();
    const data = { ...bulletin, post_time: bulletin.post_time || nowIso };
    await kvPut(env, KEYS.waLatest, {
      source: body.source || 'whatsapp-admin',
      data,
      gold: gold ? { ...gold, post_time: data.post_time } : null,
      updated_at: nowIso,
    });
    await computeRates(env);
    return json(await adminState(env), 200, { 'Cache-Control': 'no-store' });
  }
  if (sub === 'override') {
    if (body.clear) {
      await kvDel(env, KEYS.override);
    } else {
      if (!body.usd_syp?.buy || !body.usd_syp?.sell || body.usd_syp.buy > body.usd_syp.sell) {
        return json({ error: 'قيم الدولار غير صالحة' }, 400, { 'Cache-Control': 'no-store' });
      }
      const hours = Math.min(168, Math.max(1, Number(body.hours) || 12));
      const now = Date.now();
      const g21 = Number(body.gold21_syp);
      const ov = {
        source: 'إدارة صرّاف',
        usd_syp: body.usd_syp,
        try_syp: body.try_syp || null,
        eur_syp: body.eur_syp || null,
        gold: Number.isFinite(g21) && g21 > 0 ? {
          syp: { '21': g21, '24': Math.round((g21 * 24) / 21), '18': Math.round((g21 * 18) / 21), lira: g21 * 8 },
          post_time: new Date(now).toISOString(),
          source: 'إدارة صرّاف',
          kind: 'manual',
        } : null,
        post_time: new Date(now).toISOString(),
        expires_at: new Date(now + hours * 3600e3).toISOString(),
      };
      await kvPut(env, KEYS.override, ov);
    }
    await computeRates(env);
    return json(await adminState(env), 200, { 'Cache-Control': 'no-store' });
  }
  if (sub === 'config') {
    const next = {
      primary: body.primary === 'whatsapp' ? 'whatsapp' : 'telegram',
      channels: list(body.channels),
      disabled_channels: list(body.disabled_channels),
      whatsapp_feed_url: String(body.whatsapp_feed_url || '').trim(),
      auto_approve_whatsapp: !!body.auto_approve_whatsapp,
    };
    await kvPut(env, KEYS.config, next);
    await computeRates(env);
    return json(await adminState(env), 200, { 'Cache-Control': 'no-store' });
  }
  if (sub === 'pending') {
    const all = (await kvGet(env, KEYS.pending, [])) || [];
    const target = all.find((x) => x.id === body.id);
    const rest = all.filter((x) => x.id !== body.id);
    await kvPut(env, KEYS.pending, rest);
    if (target && body.action === 'approve' && target.data?.usd_syp) {
      await kvPut(env, KEYS.waLatest, {
        source: target.source || 'whatsapp',
        data: target.data,
        gold: target.gold || null,
        updated_at: new Date().toISOString(),
      });
      await computeRates(env);
    }
    return json(await adminState(env), 200, { 'Cache-Control': 'no-store' });
  }
  if (sub === 'refresh') {
    await computeRates(env);
    return json(await adminState(env), 200, { 'Cache-Control': 'no-store' });
  }
  return json({ error: 'not found' }, 404, { 'Cache-Control': 'no-store' });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);

    if (url.pathname === '/ingest/whatsapp') return handleWhatsappIngest(request, env, url);
    if (url.pathname === '/admin') {
      return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname.startsWith('/admin/api/')) {
      return handleAdminApi(request, env, url.pathname.slice('/admin/api/'.length));
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method not allowed' }, 405, { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/content') return json(CONTENT, 200, { 'Cache-Control': 'public, max-age=300' });

    if (url.pathname === '/privacy') {
      return new Response(PRIVACY, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
    }

    if (url.pathname === '/update') {
      const u = JSON.parse(JSON.stringify(UPDATE));
      const cfg = await getConfig(env);
      if (cfg.channels.length) u.channels = cfg.channels.filter((c) => !cfg.disabled_channels.includes(c));
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

    // 1) كاش بالذاكرة (سريع ويعمل حتى على workers.dev)
    if (memCache && Date.now() - memCache.t < MEM_FRESH_MS) return json(memCache.body);

    // 2) كاش KV (الذي يحدّثه الـ Cron كل 15 دقيقة — يوحّد النشرة لكل المستخدمين ويحمي المصادر)
    const cached = await kvGet(env, KEYS.latest, null);
    if (cached?.usd_syp && cached.fetched && Date.now() - Date.parse(cached.fetched) < KV_FRESH_MS) {
      memCache = { t: Date.now(), body: cached };
      return json(cached);
    }

    // 3) جلب جديد وتخزينه في KV
    const body = await computeRates(env);
    if (body.error) {
      // إذا فشل الجلب الجديد ولكن لدينا نشرة سابقة محفوظة نرجعها مع وسم cached_fallback بدل قطع الخدمة
      if (cached?.usd_syp) return json({ ...cached, stale_fallback: true, last_error: body.error }, 200, { 'Cache-Control': 'no-store' });
      return json(body, 502, { 'Cache-Control': 'no-store' });
    }
    if (env.HISTORY) ctx.waitUntil(readHistory(env).then((h) => (h.length ? null : snapshot(env))).catch(() => {}));
    return json(body);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(snapshot(env, event.scheduledTime).then((r) => console.log('snapshot', JSON.stringify(r))));
  },
};
