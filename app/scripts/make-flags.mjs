// يولّد أعلام SVG مربعة مصممة للعرض بدائرة (بدل إيموجي الأعلام اللي ما بتطلع متل بعض على كل الأجهزة)
// كل علم مرسوم على 512×512 بحيث العلامة المميزة (شريط، مثلث، نجمة، شهادة) بتضل جوا الدائرة.
// التشغيل: node scripts/make-flags.mjs   → www/img/flags/*.svg
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'www', 'img', 'flags');
mkdirSync(out, { recursive: true });

const f = (n) => +n.toFixed(2);
// نجمة بعدد رؤوس n، مركزها (cx,cy) ونصف قطرها r
function star(cx, cy, r, n = 5, inner = 0.382, rot = -90) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rr = i % 2 ? r * inner : r;
    pts.push(`${f(cx + rr * Math.cos(a))},${f(cy + rr * Math.sin(a))}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}
const S = 512;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${body}</svg>\n`;
const stripes3 = (a, b, c) => `<rect width="512" height="512" fill="${b}"/><rect width="512" height="171" fill="${a}"/><rect y="341" width="512" height="171" fill="${c}"/>`;

const flags = {
  // سوريا: أخضر / أبيض / أسود مع ثلاث نجوم حمراء (متباعدة لتضل جوا الدائرة)
  sy: svg(`${stripes3('#007A3D', '#FFFFFF', '#000000')}<g fill="#CE1126">${star(140, 256, 48)}${star(256, 256, 48)}${star(372, 256, 48)}</g>`),

  // الولايات المتحدة: 13 خط + المربع الأزرق بالزاوية مع نجوم
  us: svg((() => {
    let s = '<rect width="512" height="512" fill="#FFFFFF"/>';
    const h = 512 / 13;
    for (let i = 0; i < 13; i += 2) s += `<rect y="${f(i * h)}" width="512" height="${f(h)}" fill="#B22234"/>`;
    s += `<rect width="256" height="${f(7 * h)}" fill="#3C3B6E"/><g fill="#FFFFFF">`;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) s += star(40 + c * 46 + (r % 2) * 10, 30 + r * 50, 13);
    return s + '</g>';
  })()),

  // تركيا: هلال ونجمة بالنسب الرسمية تقريباً، بالوسط
  tr: svg(`<rect width="512" height="512" fill="#E30A17"/><circle cx="216" cy="256" r="128" fill="#FFFFFF"/><circle cx="248" cy="256" r="102" fill="#E30A17"/><g fill="#FFFFFF">${star(366, 256, 64, 5, 0.382, 180)}</g>`),

  // الاتحاد الأوروبي: 12 نجمة بدائرة
  eu: svg(`<rect width="512" height="512" fill="#003399"/><g fill="#FFCC00">${Array.from({ length: 12 }, (_, i) => { const a = (i * 30 * Math.PI) / 180; return star(256 + 150 * Math.sin(a), 256 - 150 * Math.cos(a), 30); }).join('')}</g>`),

  // السعودية: الشهادة بالأبيض فوق سيف، على أخضر
  sa: svg(`<rect width="512" height="512" fill="#006C35"/>
<text x="256" y="236" fill="#FFFFFF" font-family="Noto Naskh Arabic, Amiri, Scheherazade, Arial, sans-serif" font-size="64" font-weight="700" text-anchor="middle" direction="rtl">لا إله إلا الله</text>
<text x="256" y="306" fill="#FFFFFF" font-family="Noto Naskh Arabic, Amiri, Scheherazade, Arial, sans-serif" font-size="60" font-weight="700" text-anchor="middle" direction="rtl">محمد رسول الله</text>
<g fill="#FFFFFF"><rect x="112" y="352" width="268" height="12" rx="6"/><path d="M380 346 h22 v24 h-22 z"/><rect x="402" y="353" width="24" height="10" rx="5"/><path d="M112 352 l-16 6 l16 6 z"/></g>`),

  // الإمارات: شريط أحمر عمودي + أخضر/أبيض/أسود
  ae: svg(`${stripes3('#00732F', '#FFFFFF', '#000000')}<rect width="170" height="512" fill="#FF0000"/>`),

  // الكويت: أخضر/أبيض/أحمر + شبه منحرف أسود عند السارية
  kw: svg(`${stripes3('#007A3D', '#FFFFFF', '#CE1126')}<polygon points="0,0 170,171 170,341 0,512" fill="#000000"/>`),

  // الأردن: أسود/أبيض/أخضر + مثلث أحمر فيه نجمة سباعية بيضاء
  jo: svg(`${stripes3('#000000', '#FFFFFF', '#007A3D')}<polygon points="0,0 300,256 0,512" fill="#CE1126"/><g fill="#FFFFFF">${star(112, 256, 44, 7, 0.45, -90)}</g>`),
};
for (const [k, v] of Object.entries(flags)) writeFileSync(join(out, `${k}.svg`), v);
console.log('✓ img/flags/', Object.keys(flags).join(' '));
