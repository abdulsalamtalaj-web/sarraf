// رسم بياني خطي بسيط بـ SVG يدوي (بدون مكتبات)
// points: [{ t: ms, v: number }] مرتبة زمنياً
const VW = 320, VH = 150, PAD = { l: 44, r: 8, t: 16, b: 22 };

const fmt = (v, dec) => new Intl.NumberFormat('en-US', { maximumFractionDigits: dec }).format(v);
const dayLabel = (ms) => {
  try { return new Intl.DateTimeFormat('ar-SY-u-nu-latn', { timeZone: 'Asia/Damascus', day: 'numeric', month: 'short' }).format(new Date(ms)); }
  catch { return new Date(ms).toLocaleDateString(); }
};

export function lineChart(points, { color = '#3B82F6', dec = 2, id = 'c' } = {}) {
  const pts = points.filter((p) => p.v != null && isFinite(p.v));
  if (pts.length < 2) return null;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (hi - lo < hi * 0.002) { const m = (hi + lo) / 2; lo = m * 0.998; hi = m * 1.002; } // خط مستوي: هامش صغير
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const X = (t) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (VW - PAD.l - PAD.r);
  const Y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (VH - PAD.t - PAD.b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${X(t1).toFixed(1)},${VH - PAD.b} L${X(t0).toFixed(1)},${VH - PAD.b} Z`;
  const grid = [0, 0.5, 1].map((f) => {
    const v = lo + pad + (hi - lo - 2 * pad) * f, y = Y(v).toFixed(1);
    return `<line x1="${PAD.l}" x2="${VW - PAD.r}" y1="${y}" y2="${y}" stroke="rgba(238,244,240,.06)"/>`
      + `<text class="ax" x="${PAD.l - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${fmt(v, v >= 1000 ? 0 : dec)}</text>`;
  }).join('');
  const last = pts[pts.length - 1], lx = X(last.t), ly = Y(last.v);
  return `<svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="رسم بياني" direction="ltr">
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#g-${id})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="${color}"/>
    <text class="ax" x="${PAD.l}" y="${VH - 4}" text-anchor="start">${dayLabel(t0)}</text>
    <text class="ax" x="${VW - PAD.r}" y="${VH - 4}" text-anchor="end">${dayLabel(t1)}</text>
  </svg>`;
}
