// ================== ملف إعدادات "صرّاف" (ملف واحد) ==================
// كل القيم القابلة للتغيير هون. عدّل، اعمل push، والتحديث بيوصل للناس لحاله.
window.APP_CONFIG = {
  APP_VERSION: '3.3', // بيتبدّل تلقائياً بالبناء على GitHub (رقم النسخة الحقيقي من الـ APK)
  // رقم حزمة الواجهة للتحديث الهوائي عبر الـ Worker (اختياري). الـ APK فيه الحزمة رقم 1
  WEB_BUILD: 1,

  // ---- مصادر الأسعار ----
  // قناة التلغرام الأساسية أولاً، والباقي احتياط
  CHANNELS: ['exchange_Currencyy', 'aboothman33'],
  // رابط الـ Worker بعد نشره (مثال: 'https://sarraf-rates.NAME.workers.dev/rates'). فارغ = قراءة تلغرام مباشرة
  API_URL: '',
  GOLD_CHANNELS: '',                              // قنوات الذهب (فارغ = نفس قنوات العملات)
  GOLD_API: 'https://api.gold-api.com/price/XAU', // مصدر مجاني لسعر الأونصة بدون مفتاح
  REFRESH_SECONDS: 60,          // التحديث مع الـ Worker
  DIRECT_REFRESH_SECONDS: 300,  // التحديث بالقراءة المباشرة من تلغرام (احتياط فقط)
  STALE_MINUTES: 10,            // بعدها بيطلع تنبيه "السعر قديم"

  // ---- GitHub Pages (مجاني): التحديثات والمعلومة الطبية وصفحة التحميل ----
  PAGES_URL: 'https://abdulsalamtalaj-web.github.io/sarraf/',
  VERSION_URL: 'https://abdulsalamtalaj-web.github.io/sarraf/version.json', // آخر نسخة APK
  TIPS_URL: 'https://abdulsalamtalaj-web.github.io/sarraf/tips.json',       // المعلومة الطبية + فيديو الأسبوع
  DOWNLOAD_URL: 'https://abdulsalamtalaj-web.github.io/sarraf/',            // صفحة التحميل (بالمشاركة)
  UPDATE_URL: '', // تحديث الواجهة الهوائي عبر الـ Worker (اختياري). فارغ = <رابط الـ Worker>/update

  // ---- المشاركة ----
  SHARE_HANDLE: '@abdulsalamthalji',
  SHARE_INSTAGRAM_URL: 'https://www.instagram.com/abdulsalamthalji',

  // ---- المحوّل ----
  QUICK_AMOUNTS: [1, 10, 50, 100, 500, 1000],
  OLD_PER_NEW: 100,                                      // 1 ليرة جديدة = 100 ليرة قديمة
  OLD_QUICK_AMOUNTS: [1000, 5000, 10000, 50000, 100000], // أزرار المبالغ السريعة (بالقديم)
  // عملة عرض الذهب أول مرة: 'SYP' سوري جديد | 'SYP_OLD' سوري قديم | 'USD' دولار | 'TRY' تركي
  GOLD_DEFAULT_CURRENCY: 'SYP',

  // ---- الإشعارات ----
  NOTIFY_DEFAULT_TIME: '09:00',  // بتوقيت دمشق
  NOTIFY_MAX_TIMES: 3,           // أقصى عدد إشعارات بالوقت باليوم
  PRICE_CHANGE_PCT: 1,           // الافتراضي: إشعار إذا تغيّر السعر أكتر من 1%
  PRICE_CHANGE_MIN_HOURS: 2,     // وبحد أقصى إشعار كل ساعتين

  // ---- عن المطوّر ----
  DEVELOPER: {
    name: 'عبد السلام ثلجة',
    tagline: 'عملت هالتطبيق ببلاش لأهل بلدي',
    subtitle: 'مطوّر تطبيقات وصانع محتوى طبي',
    // حط صورتك بهالمسار: app/www/img/developer.png (مربعة). إذا مو موجودة، دائرة الصورة بتختفي.
    photo: 'img/developer.png',
  },

  // ---- زر "بدك تطبيق أو تصميم لشغلك؟ تواصل معي" (واتساب) ----
  WHATSAPP_NUMBER: '963994621614',
  WHATSAPP_MESSAGE: 'مرحبا عبد السلام، شفت تطبيق صرّاف وحابب أحكي معك',
  CONTACT_LABEL: 'بدك تطبيق أو تصميم لشغلك؟ تواصل معي',

  // ---- قنواتي ---- (أي رابط فاضي ما بيبين)
  // المنصات المدعومة بأيقونتها الرسمية: instagram, facebook, youtube, tiktok, telegram, x
  SOCIAL: [
    { platform: 'instagram', label: 'إنستغرام', url: 'https://www.instagram.com/abdulsalamthalji' },
    { platform: 'facebook', label: 'فيسبوك', url: 'https://www.facebook.com/share/1HvdJ4i48U/' },
    { platform: 'youtube', label: 'يوتيوب', url: 'https://www.youtube.com/channel/UCsfUZ57iOBIKdqFLVj1Qexw' },
    { platform: 'tiktok', label: 'تيك توك', url: 'https://www.tiktok.com/@abdulsalamthalji' },
  ],
};
// رابط واتساب مبني من الرقم والرسالة
window.APP_CONFIG.CONTACT_URL = window.APP_CONFIG.WHATSAPP_NUMBER
  ? 'https://wa.me/' + window.APP_CONFIG.WHATSAPP_NUMBER + '?text=' + encodeURIComponent(window.APP_CONFIG.WHATSAPP_MESSAGE)
  : '';
