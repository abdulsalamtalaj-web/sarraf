// يُشغَّل قبل كل بناء:
//  1) ينسخ المحلّل ومنطق الأسعار من مجلد الـ Worker إلى التطبيق (مصدر كود واحد)
//  2) يولّد أيقونات المنصات الرسمية من حزمة simple-icons
//  3) يبني سكربت الإشعار الصباحي (Background Runner) كملف واحد بدون modules
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as si from 'simple-icons';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const www = join(root, 'app', 'www');
const lib = join(www, 'lib');
mkdirSync(lib, { recursive: true });

// 1) المحلّل
copyFileSync(join(root, 'worker', 'src', 'parser.js'), join(lib, 'parser.js'));
copyFileSync(join(root, 'worker', 'src', 'rates.js'), join(lib, 'rates.js'));

// 2) أيقونات المنصات (المسار الرسمي + اللون الرسمي)
const icons = {
  instagram: si.siInstagram, facebook: si.siFacebook, youtube: si.siYoutube,
  tiktok: si.siTiktok, telegram: si.siTelegram, x: si.siX,
};
const out = Object.fromEntries(Object.entries(icons).map(([k, v]) => [k, { title: v.title, hex: v.hex, path: v.path }]));
writeFileSync(join(lib, 'social-icons.js'), `// مولّد تلقائياً من simple-icons (CC0) — لا تعدّله يدوياً\nexport const SOCIAL_ICONS = ${JSON.stringify(out)};\n`);

// 3) سكربت الخلفية: parser + rates + daily (بدون import/export)
const strip = (s) => s.replace(/^import .*$/gm, '').replace(/^export (default )?/gm, '');
const runner = [
  '// مولّد تلقائياً بواسطة scripts/sync-lib.mjs — عدّل app/scripts/daily-runner.src.js بدلاً منه',
  strip(readFileSync(join(root, 'worker', 'src', 'parser.js'), 'utf8')),
  strip(readFileSync(join(root, 'worker', 'src', 'rates.js'), 'utf8')),
  readFileSync(join(root, 'app', 'scripts', 'daily-runner.src.js'), 'utf8'),
].join('\n');
mkdirSync(join(www, 'runners'), { recursive: true });
writeFileSync(join(www, 'runners', 'daily.js'), runner);
// 4) الخطوط محلياً (تعمل بدون إنترنت): IBM Plex Sans Arabic للنص، Manrope للأرقام — رخصة OFL
const fonts = join(www, 'fonts');
mkdirSync(fonts, { recursive: true });
const fs_ = join(root, 'app', 'node_modules', '@fontsource');
for (const f of ['arabic-400', 'arabic-700', 'latin-400', 'latin-700'])
  copyFileSync(join(fs_, 'ibm-plex-sans-arabic', 'files', `ibm-plex-sans-arabic-${f}-normal.woff2`), join(fonts, `plex-${f}.woff2`));
for (const w of ['500', '700'])
  copyFileSync(join(fs_, 'manrope', 'files', `manrope-latin-${w}-normal.woff2`), join(fonts, `manrope-${w}.woff2`));
// 5) صفحة سياسة الخصوصية (نفس الملف اللي بيخدمه الـ Worker على /privacy)
copyFileSync(join(root, 'worker', 'privacy.html'), join(www, 'privacy.html'));
// 6) أعلام SVG
await import('./make-flags.mjs');
console.log('✓ lib/parser.js, lib/rates.js, lib/social-icons.js, runners/daily.js, fonts/, privacy.html');
