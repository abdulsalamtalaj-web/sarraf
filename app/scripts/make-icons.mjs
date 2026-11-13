// يجهّز أيقونات "صرّاف" من اللوغو الأصلي assets/logo-source.png بدون تعديل تصميمه:
//  - يغطي النسخة المصغّرة الموجودة في زاوية الصورة بلون الخلفية فقط
//  - يفصل الرمز عن الخلفية الخضراء (Flood fill من الأطراف) لطبقة أمامية شفافة
//  - يضع الرمز داخل المنطقة الآمنة (66%) للأيقونة التكيفية
//  - يولّد كل مقاسات mipmap + شاشة البداية + 512×512 للمتجر + نسخة للواجهة
import sharp from 'sharp';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = (f) => join(root, 'assets', f);
const BG = { r: 2, g: 80, b: 49 }; // لون خلفية اللوغو الفعلي (#025031)
const BG_HEX = '#025031';

// 1) قراءة اللوغو وتغطية النسخة المصغّرة في الزاوية السفلية اليمنى
const src = sharp(A('logo-source.png')).removeAlpha();
const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const sx = (v) => Math.round((v * W) / 1254);
for (let y = sx(1025); y < sx(1200); y++)
  for (let x = sx(1025); x < sx(1200); x++) {
    const i = (y * W + x) * 3;
    data[i] = BG.r; data[i + 1] = BG.g; data[i + 2] = BG.b;
  }
const clean = sharp(data, { raw: { width: W, height: H, channels: 3 } });
await clean.clone().png().toFile(A('logo-clean.png'));

// 2) فصل الرمز: كل بكسل قريب من لون الخلفية ومتصل بأطراف الصورة يصبح شفافاً
const near = (i) => Math.abs(data[i] - BG.r) + Math.abs(data[i + 1] - BG.g) + Math.abs(data[i + 2] - BG.b) < 60;
const alpha = new Uint8Array(W * H).fill(255);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const p = stack.pop();
  if (alpha[p] === 0 || !near(p * 3)) continue;
  alpha[p] = 0;
  const x = p % W, y = (p / W) | 0;
  if (x > 0) stack.push(p - 1);
  if (x < W - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - W);
  if (y < H - 1) stack.push(p + W);
}
// حواف ناعمة
const softAlpha = await sharp(Buffer.from(alpha), { raw: { width: W, height: H, channels: 1 } }).blur(0.8).extractChannel(0).raw().toBuffer();
const rgba = Buffer.alloc(W * H * 4);
let cx = 0, cy = 0, n = 0;
for (let p = 0; p < W * H; p++) {
  rgba[p * 4] = data[p * 3]; rgba[p * 4 + 1] = data[p * 3 + 1]; rgba[p * 4 + 2] = data[p * 3 + 2];
  rgba[p * 4 + 3] = softAlpha[p];
  if (alpha[p]) { cx += p % W; cy += (p / W) | 0; n++; }
}
// مركز الرمز وأبعد نقطة عنه (لضمان بقائه داخل الدائرة الآمنة)
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let p = 0; p < W * H; p++) if (alpha[p]) {
  const x = p % W, y = (p / W) | 0;
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}
const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2;
let R = 0;
for (let p = 0; p < W * H; p++) if (alpha[p]) {
  const dx = (p % W) - ccx, dy = ((p / W) | 0) - ccy;
  R = Math.max(R, Math.hypot(dx, dy));
}
console.log(`الرمز: مركز (${ccx | 0},${ccy | 0}) نصف قطر ${R | 0}px`);

// قص الرمز في مربع مركزه مركز الرمز وطوله 2R
const side = Math.ceil(2 * R) + 4;
const padded = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .extend({ top: side, bottom: side, left: side, right: side, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer();
const sym = await sharp(padded)
  .extract({ left: Math.round(ccx - side / 2) + side, top: Math.round(ccy - side / 2) + side, width: side, height: side })
  .png().toBuffer();
await sharp(sym).toFile(A('logo-symbol.png'));

// 3) الطبقة الأمامية: قطر الرمز = 64% من 1024 (داخل الـ 66% الآمنة)
const FG = 1024, symSize = Math.round(FG * 0.64);
const symResized = await sharp(sym).resize(symSize, symSize).png().toBuffer();
await sharp({ create: { width: FG, height: FG, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: symResized, gravity: 'center' }]).png().toFile(A('icon-foreground.png'));
// الطبقة الخلفية: أخضر اللوغو
await sharp({ create: { width: FG, height: FG, channels: 3, background: BG } }).png().toFile(A('icon-background.png'));
// الأيقونة الكاملة (للأجهزة القديمة) = اللوغو الأصلي بعد التنظيف
await sharp(A('logo-clean.png')).resize(1024, 1024).png().toFile(A('icon-only.png'));

// 4) شاشة البداية: خلفية خضراء والرمز في المنتصف
const SP = 2732, spSym = await sharp(sym).resize(900, 900).png().toBuffer();
for (const f of ['splash.png', 'splash-dark.png'])
  await sharp({ create: { width: SP, height: SP, channels: 3, background: BG } })
    .composite([{ input: spSym, gravity: 'center' }]).png().toFile(A(f));

// 5) أيقونة المتجر 512×512 + نسخ للواجهة
mkdirSync(join(root, '..', 'store'), { recursive: true });
await sharp(A('logo-clean.png')).resize(512, 512).png().toFile(join(root, '..', 'store', 'icon-512.png'));
mkdirSync(join(root, 'www', 'img'), { recursive: true });
await sharp(A('logo-clean.png')).resize(256, 256).png().toFile(join(root, 'www', 'img', 'logo.png'));
await sharp(sym).resize(96, 96).png().toFile(join(root, 'www', 'img', 'logo-symbol.png'));
// أيقونة الإشعار (أبيض على شفاف، مطلوبة لشريط الحالة في أندرويد)
const resDir = join(root, 'android', 'app', 'src', 'main', 'res');
const mono = await sharp(sym).ensureAlpha().extractChannel('alpha').toColourspace('b-w').toBuffer();
for (const [d, s] of [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]) {
  mkdirSync(join(resDir, `drawable-${d}`), { recursive: true });
  const a = await sharp(mono).resize(s, s).raw().toBuffer();
  const px = Buffer.alloc(s * s * 4);
  for (let i = 0; i < s * s; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255; px[i * 4 + 3] = a[i]; }
  await sharp(px, { raw: { width: s, height: s, channels: 4 } }).png().toFile(join(resDir, `drawable-${d}`, 'ic_stat_sarraf.png'));
}
console.log('✓ صور الأيقونة جاهزة');

execSync(`npx capacitor-assets generate --android --iconBackgroundColor "${BG_HEX}" --splashBackgroundColor "${BG_HEX}" --splashBackgroundColorDark "${BG_HEX}"`, { stdio: 'inherit', cwd: root });

// @capacitor/assets يضع الطبقة الأمامية بحجم 100%؛ نعيد توليدها بالحجم الآمن مع هامش الـ 108dp
for (const [d, s] of [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]]) {
  await sharp(A('icon-foreground.png')).resize(s, s).png().toFile(join(resDir, `mipmap-${d}`, 'ic_launcher_foreground.png'));
  await sharp(A('icon-background.png')).resize(s, s).png().toFile(join(resDir, `mipmap-${d}`, 'ic_launcher_background.png'));
}
// تعريف الأيقونة التكيفية بدون inset إضافي (الطبقة الأمامية فيها هامش المنطقة الآمنة أصلاً)
const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) writeFileSync(join(resDir, 'mipmap-anydpi-v26', f), xml);
console.log('✓ mipmap بكل الكثافات');

// 3.1: capacitor-assets بيولّد شاشة البداية بـ 26 نسخة (طولي/عرضي/ليلي) وكلها نفس الصورة تقريباً.
// منخلي نسخة وحدة مضغوطة (drawable-xxhdpi) ومنحذف الباقي (وفّر ~3.5 ميغا).
{
  const { readdirSync, rmSync, mkdirSync: mk, existsSync } = await import('node:fs');
  const sharpLib = (await import('sharp')).default;
  const src = join(resDir, 'drawable-port-xxhdpi', 'splash.png');
  if (existsSync(src)) {
    mk(join(resDir, 'drawable-xxhdpi'), { recursive: true });
    const buf = await sharpLib(src).png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
    for (const d of readdirSync(resDir)) {
      if (/^drawable-(land|port|night)/.test(d) || d === 'drawable-night') rmSync(join(resDir, d), { recursive: true, force: true });
    }
    rmSync(join(resDir, 'drawable', 'splash.png'), { force: true });
    writeFileSync(join(resDir, 'drawable-xxhdpi', 'splash.png'), buf);
    console.log('✓ شاشة البداية: نسخة وحدة مضغوطة');
  }
}
