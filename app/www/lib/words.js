// تحويل الأرقام إلى كلمات باللهجة السورية: 150000 → "مية وخمسين ألف"
const ONES = ['', 'واحد', 'اتنين', 'تلاتة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'تمانية', 'تسعة', 'عشرة',
  'إحدعش', 'اتنعش', 'تلتعش', 'أربعتعش', 'خمستعش', 'ستعش', 'سبعتعش', 'تمنتعش', 'تسعتعش'];
const TENS = ['', '', 'عشرين', 'تلاتين', 'أربعين', 'خمسين', 'ستين', 'سبعين', 'تمانين', 'تسعين'];
const HUNDREDS = ['', 'مية', 'ميتين', 'تلتمية', 'أربعمية', 'خمسمية', 'ستمية', 'سبعمية', 'تمنمية', 'تسعمية'];
// صيغة العدد قبل "تلاف/ملايين" (3 إلى 10)
const COUNTED = ['', '', '', 'تلت', 'أربع', 'خمس', 'ست', 'سبع', 'تمن', 'تسع', 'عشر'];

function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const parts = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const t = Math.floor(r / 10), o = r % 10;
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

// one: "ألف"، two: "ألفين"، plural: "تلاف"
function scaleWords(n, one, two, plural) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${COUNTED[n]} ${plural}`;
  return `${below1000(n)} ${one}`;
}

export function intToWords(num) {
  num = Math.floor(Math.abs(num));
  if (num === 0) return 'صفر';
  const groups = [
    [1e12, 'تريليون', 'تريليونين', 'تريليونات'],
    [1e9, 'مليار', 'مليارين', 'مليارات'],
    [1e6, 'مليون', 'مليونين', 'ملايين'],
    [1e3, 'ألف', 'ألفين', 'تلاف'],
  ];
  const parts = [];
  for (const [v, one, two, pl] of groups) {
    const c = Math.floor(num / v);
    if (c) { parts.push(scaleWords(c % 1000 === c ? c : c, one, two, pl)); num %= v; }
  }
  if (num) parts.push(below1000(num));
  return parts.join(' و');
}

// المبلغ بالكلمات مع اسم العملة والقروش (للليرة الجديدة)
export function amountToWords(value, unit, subunit = 'قرش') {
  if (!isFinite(value) || value <= 0) return '';
  const int = Math.floor(value + 1e-9);
  const frac = Math.round((value - int) * 100);
  let s = int ? `${intToWords(int)} ${unit}` : '';
  if (frac && subunit) s += `${s ? ' و' : ''}${intToWords(frac)} ${subunit}`;
  return s;
}
