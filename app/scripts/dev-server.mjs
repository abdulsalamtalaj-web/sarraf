// خادم معاينة محلي: يخدم مجلد www ويحاكي الـ Worker على /rates (نفس كود المحلّل)
// التشغيل: node app/scripts/dev-server.mjs  ثم افتح http://localhost:5173
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRates } from '../../worker/src/rates.js';

const www = join(dirname(fileURLToPath(import.meta.url)), '..', 'www');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const page = async (ch) => (await fetch(`https://t.me/s/${ch}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
const fx = async () => (await (await fetch('https://open.er-api.com/v6/latest/USD')).json()).rates;
let cache = null;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/content') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(await readFile(join(www, '..', '..', 'worker', 'content.json')));
  }
  if (url.pathname === '/__save' && req.method === 'POST') {
    // للمعاينة فقط: حفظ صورة المشاركة المولّدة لفحصها
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', async () => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(www, '..', '..', 'share-preview.png'), Buffer.from(b.split(',')[1], 'base64'));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  if (url.pathname === '/history') {
    // سجل تجريبي للمعاينة: 30 يوم، نقطة كل ساعة (الـ Worker الحقيقي بيخزّن لقطات حقيقية بـ KV)
    const now = Date.now(), points = [];
    for (let i = 30 * 24; i >= 0; i--) {
      const t = now - i * 3600e3, w = Math.sin(i / 37) * 2 + Math.sin(i / 7) * 0.6 + (720 - i) * 0.004;
      const usd = 144 + w;
      points.push({ t: new Date(t).toISOString(), usd_buy: +(usd - 0.25).toFixed(2), usd_sell: +(usd + 0.25).toFixed(2), g21_usd: +(107 + Math.sin(i / 50) * 3).toFixed(2), g21_syp: +((107 + Math.sin(i / 50) * 3) * (usd + 0.25)).toFixed(0) });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ days: 30, points }));
  }
  if (url.pathname === '/rates') {
    if (!cache || Date.now() - cache.t > 60000) cache = { t: Date.now(), body: await buildRates(['exchange_Currencyy', 'aboothman33'], page, fx) };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(cache.body));
  }
  try {
    const f = join(www, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    const data = await readFile(f);
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(5173, () => console.log('http://localhost:5173'));
