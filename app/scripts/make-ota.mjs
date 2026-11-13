// تجهيز تحديث هوائي (OTA) للواجهة — بدون APK جديد
// الخطوات:
//   1) عدّل الواجهة (www/) وزِد WEB_BUILD بـ www/config.js بواحد
//   2) cd app && npm run ota
//   3) cd ../worker && npx wrangler deploy
// كل المستخدمين اللي عندهم APK رقم versionCode >= minNative بيوصلهم التحديث لحاله.
// ملاحظة: مهام الخلفية (runners/daily.js) والكود الأصلي (Java) ما بيتحدّثوا هوائياً — بدهم APK جديد.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(app, '..');
const www = join(app, 'www');
const otaDir = join(root, 'worker', 'public', 'ota');
const updFile = join(root, 'worker', 'update.json');

// المحلّل والأعلام وغيرها لازم تكون محدّثة بالحزمة
execFileSync(process.execPath, [join(app, 'scripts', 'sync-lib.mjs')], { stdio: 'inherit' });

const cfg = readFileSync(join(www, 'config.js'), 'utf8');
const build = +((cfg.match(/WEB_BUILD:\s*(\d+)/) || [])[1] || 0);
if (!build) throw new Error('ما لقينا WEB_BUILD بـ www/config.js');
const gradle = readFileSync(join(app, 'android', 'app', 'build.gradle'), 'utf8');
const versionCode = +(gradle.match(/versionCode\s+(\d+)/) || [])[1];

mkdirSync(otaDir, { recursive: true });
// نخلّي آخر حزمتين بس
for (const f of readdirSync(otaDir)) {
  const m = f.match(/^web-(\d+)\.zip$/);
  if (m && +m[1] < build - 1) rmSync(join(otaDir, f));
}
const zip = join(otaDir, `web-${build}.zip`);
if (existsSync(zip)) rmSync(zip);
// tar.exe الموجود بويندوز 10+ بيعمل zip بمسارات بشرطة / (مناسبة لأندرويد)
// على ويندوز: tar.exe تبع النظام (مو tar تبع Git اللي بيفهم "C:" كجهاز بعيد)
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(TAR, ['-a', '-c', '-f', zip, '-C', www, '.'], { stdio: 'inherit' });
const buf = readFileSync(zip);
const sha256 = createHash('sha256').update(buf).digest('hex');

const upd = JSON.parse(readFileSync(updFile, 'utf8'));
upd.web = { ...(upd.web || {}), build, minNative: upd.web?.minNative || versionCode, url: `/ota/web-${build}.zip`, sha256 };
writeFileSync(updFile, JSON.stringify(upd, null, 2) + '\n');
console.log(`✓ حزمة الواجهة رقم ${build}: ${(buf.length / 1024).toFixed(0)} KB · sha256 ${sha256.slice(0, 16)}…`);
console.log('  هلأ: cd ../worker && npx wrangler deploy');
