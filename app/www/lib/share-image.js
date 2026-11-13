// صورة "شارك السعر" مرسومة على canvas (بدون مكتبات)
//   format 'post'  1080×1350 (4:5) لمنشورات فيسبوك وإنستغرام
//   format 'story' 1080×1920 (9:16) للستوري وحالة واتساب — المحتوى ضمن المنطقة الآمنة (بعيد عن أزرار إنستغرام فوق وتحت)
// rows: [{ label, flag (رابط صورة أو null), main, sub, color, mainColor }]
// رابط التحميل وحساب إنستغرام بينكتبوا على الصورة نفسها، لأن إنستغرام وفيسبوك بيتجاهلوا النص المرفق
const W = 1080;
const LAYOUT = {
  post: { H: 1350, logoY: 48, logo: 128, titleY: 240, dateY: 292, cardsY: 336, cardH: 210, gap: 22, ctaY: 1036, noteY: 1186, lineY: 1214, footY: 1280 },
  // ستوري: أعلى 250 وأسفل 340 بكسل بتغطيهم أزرار إنستغرام → كل شي بين 250 و 1580
  story: { H: 1920, logoY: 250, logo: 136, titleY: 452, dateY: 504, cardsY: 552, cardH: 220, gap: 24, ctaY: 1296, noteY: 1440, lineY: 1472, footY: 1536 },
};
const C = {
  bg: '#0A1410', card: '#12201A', ink: '#EEF4F0', ink2: 'rgba(238,244,240,.80)', ink3: 'rgba(238,244,240,.58)',
  gold: '#F5C542', usd: '#3B82F6', try: '#EF4444', syp: '#1DB954',
};
const AR = '"Plex Arabic", "Noto Sans Arabic", sans-serif';
const NUM = '"Manrope", "Plex Arabic", sans-serif';

function loadImg(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function text(ctx, s, x, y, { font, color, align = 'right', dir = 'rtl' }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.direction = dir;
  ctx.fillText(s, x, y);
}
// تصغير الخط لحتى يساع النص بالعرض المتاح
function fit(ctx, s, maxW, size, weight, family) {
  let px = size;
  ctx.font = `${weight} ${px}px ${family}`;
  while (px > 18 && ctx.measureText(s).width > maxW) { px -= 2; ctx.font = `${weight} ${px}px ${family}`; }
  return `${weight} ${px}px ${family}`;
}

export async function drawShareImage({ rows, dateLine, logo = 'img/logo.png', author, appName = 'صرّاف', note, handle = '', link = '', format = 'post' }) {
  const L = LAYOUT[format] || LAYOUT.post;
  const H = L.H;
  // الخطوط لازم تكون محمّلة قبل الرسم وإلا canvas بيستعمل خط النظام
  try {
    await Promise.all([
      document.fonts.load(`700 64px ${AR}`, 'صرّاف'), document.fonts.load(`400 32px ${AR}`, 'الدولار'),
      document.fonts.load(`700 72px ${NUM}`, '0123456789'), document.fonts.load(`500 32px ${NUM}`, '0123456789'),
    ]);
  } catch { /* نكمل بخط النظام */ }

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // توهج ذهبي خفيف خلف الشعار
  const gy = L.logoY + L.logo / 2;
  const glow = ctx.createRadialGradient(W / 2, gy, 10, W / 2, gy, 520);
  glow.addColorStop(0, 'rgba(245,197,66,.14)');
  glow.addColorStop(1, 'rgba(245,197,66,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, gy + 520);

  // الرأس: الشعار + الاسم + التاريخ
  const img = await loadImg(logo);
  if (img) {
    const s = L.logo, x0 = W / 2 - s / 2;
    ctx.save(); rr(ctx, x0, L.logoY, s, s, s / 4); ctx.clip(); ctx.drawImage(img, x0, L.logoY, s, s); ctx.restore();
  }
  text(ctx, appName, W / 2, L.titleY, { font: `700 68px ${AR}`, color: C.gold, align: 'center' });
  text(ctx, dateLine, W / 2, L.dateY, { font: `400 32px ${AR}`, color: C.ink3, align: 'center' });

  // البطاقات: ارتفاعها بيصغر لحتى تساع كل العملات المفعّلة (لحد 5)
  const x = 72, w = W - 144;
  const space = L.ctaY - 28 - L.cardsY;
  const gap = rows.length > 3 ? 16 : L.gap;
  const h = Math.min(L.cardH, Math.floor((space - gap * (rows.length - 1)) / Math.max(1, rows.length)));
  const k = h / L.cardH; // نسبة تصغير الخطوط
  let y = L.cardsY;
  for (const r of rows) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,8,4,.45)'; ctx.shadowBlur = 32; ctx.shadowOffsetY = 10;
    ctx.fillStyle = C.card; rr(ctx, x, y, w, h, 36); ctx.fill();
    ctx.restore();
    // خط لون العائلة على اليمين
    ctx.fillStyle = r.color; rr(ctx, x + w - 10, y + 40 * k, 8, h - 80 * k, 4); ctx.fill();
    // العلم
    const fr = Math.round(34 * Math.max(k, 0.75)), fy = y + 68 * k;
    let labelRight = x + w - 48;
    if (r.flag && r.flag.startsWith('img/')) {
      const f = await loadImg(r.flag);
      if (f) {
        ctx.save();
        ctx.beginPath(); ctx.arc(x + w - 54 - fr, fy, fr, 0, Math.PI * 2); ctx.clip();
        const s = Math.max((2 * fr) / f.width, (2 * fr) / f.height);
        ctx.drawImage(f, x + w - 54 - fr - (f.width * s) / 2, fy - (f.height * s) / 2, f.width * s, f.height * s);
        ctx.restore();
        labelRight = x + w - 72 - 2 * fr;
      }
    }
    text(ctx, r.label, labelRight, y + 82 * k, { font: `700 ${Math.round(38 * Math.max(k, 0.8))}px ${AR}`, color: C.ink2 });
    // الرقم الكبير (من اليسار لليمين)
    text(ctx, r.main, x + 48, y + h - 62 * k, { font: `700 ${Math.round(74 * Math.max(k, 0.7))}px ${NUM}`, color: r.mainColor || C.ink, align: 'left', dir: 'ltr' });
    if (r.sub && k > 0.8) text(ctx, r.sub, x + w - 48, y + h - 34 * k, { font: `400 28px ${AR}`, color: C.ink3 });
    y += h + gap;
  }

  // شريط: "تابعني على إنستغرام @… • حمّل صرّاف مجاناً: الرابط" (مكتوب على الصورة لأن إنستغرام وفيسبوك بيرموا النص المرفق)
  const ctaH = 108;
  ctx.fillStyle = 'rgba(245,197,66,.12)'; rr(ctx, x, L.ctaY, w, ctaH, 28); ctx.fill();
  // ‎⁦…⁩ بيعزل الحساب والرابط كنص من اليسار لليمين (وإلا الـ @ بتطلع بالطرف الغلط)
  const ltr = (s) => '⁦' + s + '⁩';
  const line1 = handle ? `تابعني على إنستغرام ${ltr(handle)}` : '📲 تطبيق صرّاف';
  const line2 = link ? `حمّل صرّاف مجاناً: ${ltr(link)}` : 'حمّل صرّاف مجاناً';
  text(ctx, line1, W / 2, L.ctaY + 46, { font: fit(ctx, line1, w - 72, 34, 700, AR), color: C.gold, align: 'center' });
  text(ctx, line2, W / 2, L.ctaY + 88, { font: fit(ctx, line2, w - 72, 30, 500, AR), color: C.ink, align: 'center' });

  // التذييل: ملاحظة + الاسم
  if (note) text(ctx, note, W / 2, L.noteY, { font: `400 26px ${AR}`, color: C.ink3, align: 'center' });
  ctx.fillStyle = 'rgba(238,244,240,.08)'; ctx.fillRect(72, L.lineY, W - 144, 2);
  text(ctx, author, W - 72, L.footY, { font: `700 34px ${AR}`, color: C.ink2 });
  text(ctx, 'تطبيق صرّاف · مجاني', 72, L.footY, { font: `400 30px ${AR}`, color: C.gold, align: 'left' });
  return cv;
}
