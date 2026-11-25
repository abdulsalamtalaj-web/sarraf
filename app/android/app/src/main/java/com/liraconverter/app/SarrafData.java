package com.liraconverter.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * مصدر البيانات الموحّد لجميع الويدجتات (2×1، 4×1، 4×2، 4×3) والإشعارات والمزامنة بالخلفية.
 */
public final class SarrafData {
    private static final String TAG = "SarrafData";
    public static final String PREFS = "sarraf_native";
    public static final String RUNNER_PREFS = "com.liraconverter.app.daily";
    public static final int PARSER_VERSION = 2;
    public static final TimeZone DAMASCUS = TimeZone.getTimeZone("GMT+03:00");

    private SarrafData() {}

    public static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    public static SharedPreferences runner(Context c) { return c.getSharedPreferences(RUNNER_PREFS, Context.MODE_PRIVATE); }

    /** التحقق الصارم من سلامة نشرة الأسعار (تجاهل أي كاش قديم مسموم مثل 36/36 من إصدار 3.3.6) */
    public static boolean isSaneRates(JSONObject r) {
        if (r == null) return false;
        if (r.optInt("parser_v", 0) < PARSER_VERSION) return false;
        JSONObject usd = r.optJSONObject("usd_syp");
        if (usd == null) return false;
        double b = usd.optDouble("buy", Double.NaN);
        double s = usd.optDouble("sell", Double.NaN);
        if (Double.isNaN(b) || Double.isNaN(s) || b < 50.0 || s > 2000.0 || b > s) return false;
        if (Math.abs(b - s) < 1e-6 && !r.has("try_syp") && !r.has("eur_syp")) return false;
        return true;
    }

    /** فحص فوري (<1ms) لتوفر اتصال شبكة على أندرويد بدون أي طلب DNS قد يجمّد التطبيق */
    public static boolean isNetworkAvailable(Context c) {
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            if (Build.VERSION.SDK_INT >= 23) {
                Network net = cm.getActiveNetwork();
                if (net == null) return false;
                NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            }
            NetworkInfo info = cm.getActiveNetworkInfo();
            return info != null && info.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    public static JSONObject runnerJson(Context c, String key) {
        try {
            String s = runner(c).getString(key, null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) { return null; }
    }

    public static JSONObject appJson(Context c, String key) {
        try {
            String s = prefs(c).getString(key, null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) { return null; }
    }

    public static boolean hasAnyWidget(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        Class<?>[] cls = { RatesWidget.class, RatesWidgetSmall.class, RatesWidgetBar.class, RatesWidgetFull.class };
        for (Class<?> cl : cls) {
            int[] ids = m.getAppWidgetIds(new ComponentName(c, cl));
            if (ids != null && ids.length > 0) return true;
        }
        return false;
    }

    public static long parseIso(String iso) {
        if (iso == null || iso.length() < 19) return 0;
        try {
            String base = iso.substring(0, 19);
            String tail = iso.substring(19).replaceAll("^\\.\\d+", "");
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            if (tail.isEmpty() || tail.equals("Z")) {
                f.setTimeZone(TimeZone.getTimeZone("UTC"));
                return f.parse(base).getTime();
            }
            if (tail.matches("^[+-]\\d{2}:?\\d{2}$")) {
                String tz = tail.contains(":") ? tail : tail.substring(0, 3) + ":" + tail.substring(3);
                f.setTimeZone(TimeZone.getTimeZone("GMT" + tz));
                return f.parse(base).getTime();
            }
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(base).getTime();
        } catch (Exception e) {
            Log.w(TAG, "parseIso failed: " + iso, e);
            return 0;
        }
    }

    /** لقطة أسعار كاملة (شراء + مبيع لكل العملات + الذهب بالدولار والسوري) */
    public static class Snapshot {
        public double usdBuy = Double.NaN, usdSell = Double.NaN;
        public double tryBuy = Double.NaN, trySell = Double.NaN;
        public double eurBuy = Double.NaN, eurSell = Double.NaN;
        public double utBuy = Double.NaN, utSell = Double.NaN;
        public int usdDir = 0;

        public double g21Usd = Double.NaN, g18Usd = Double.NaN, g24Usd = Double.NaN, gLiraUsd = Double.NaN;
        public double g21Syp = Double.NaN;
        public boolean goldLocal = false;

        public long at = 0;      // وقت الجلب
        public long postAt = 0;  // وقت النشرة الفعلي
    }

    static double optNum(JSONObject o, String key) {
        return o == null ? Double.NaN : o.optDouble(key, Double.NaN);
    }

    private static void applyRatesJson(Snapshot s, JSONObject r, double refUsdBuy) {
        JSONObject usd = r.optJSONObject("usd_syp");
        if (usd != null) {
            double b = optNum(usd, "buy"), sl = optNum(usd, "sell");
            if (!Double.isNaN(b) && !Double.isNaN(refUsdBuy)) s.usdDir = Double.compare(b, refUsdBuy);
            if (!Double.isNaN(b)) s.usdBuy = b;
            if (!Double.isNaN(sl)) s.usdSell = sl;
        }
        JSONObject tr = r.optJSONObject("try_syp");
        if (tr != null) {
            double b = optNum(tr, "buy"), sl = optNum(tr, "sell");
            if (!Double.isNaN(b)) s.tryBuy = b;
            if (!Double.isNaN(sl)) s.trySell = sl;
        }
        JSONObject eu = r.optJSONObject("eur_syp");
        if (eu != null) {
            double b = optNum(eu, "buy"), sl = optNum(eu, "sell");
            if (!Double.isNaN(b)) s.eurBuy = b;
            if (!Double.isNaN(sl)) s.eurSell = sl;
        }
        JSONObject ut = r.optJSONObject("try_usd");
        if (ut != null) {
            double b = optNum(ut, "buy"), sl = optNum(ut, "sell");
            if (!Double.isNaN(b)) s.utBuy = b;
            if (!Double.isNaN(sl)) s.utSell = sl;
        }
        JSONObject gold = r.optJSONObject("gold");
        if (gold != null) {
            s.goldLocal = gold.optBoolean("is_local", !gold.optBoolean("estimated", true));
            JSONObject gusd = gold.optJSONObject("usd");
            JSONObject gsyp = gold.optJSONObject("syp");
            if (gusd != null) {
                s.g21Usd = optNum(gusd, "21");
                s.g18Usd = optNum(gusd, "18");
                s.g24Usd = optNum(gusd, "24");
                s.gLiraUsd = optNum(gusd, "lira");
            }
            if (gsyp != null && gsyp.has("21")) {
                s.g21Syp = optNum(gsyp, "21");
            } else if (!Double.isNaN(s.g21Usd) && !Double.isNaN(s.usdSell)) {
                s.g21Syp = s.g21Usd * s.usdSell;
            }
        }
    }

    public static Snapshot latest(Context c) {
        JSONObject w = appJson(c, "widget");
        JSONObject r = runnerJson(c, "lastRates");
        if (w == null && r == null) return null;

        Snapshot s = new Snapshot();
        if (w != null && w.optInt("parser_v", 0) >= PARSER_VERSION) {
            s.at = w.optLong("at", 0);
            s.postAt = w.optLong("postAt", 0);
            s.usdDir = w.optInt("usdDir", 0);
            s.usdBuy = optNum(w, "usdBuy");
            s.usdSell = optNum(w, "usdSell");
            if (Double.isNaN(s.usdBuy)) s.usdBuy = optNum(w, "usd");
            if (Double.isNaN(s.usdSell)) s.usdSell = s.usdBuy;
            s.tryBuy = optNum(w, "tryBuy");
            s.trySell = optNum(w, "trySell");
            s.eurBuy = optNum(w, "eurBuy");
            s.eurSell = optNum(w, "eurSell");
            s.utBuy = optNum(w, "utBuy");
            s.utSell = optNum(w, "utSell");
            s.g21Usd = optNum(w, "g21Usd");
            s.g18Usd = optNum(w, "g18Usd");
            s.g24Usd = optNum(w, "g24Usd");
            s.gLiraUsd = optNum(w, "gLiraUsd");
            s.g21Syp = optNum(w, "g21");
            s.goldLocal = w.optBoolean("goldLocal", false);
        }

        if (r != null && isSaneRates(r)) {
            long rAt = parseIso(r.optString("fetched", null));
            long rPost = parseIso(r.optString("post_time", null));
            // لا نسمح لنشرة خلفية أقدم (من حيث وقت النشرة الفعلي) بالكتابة فوق نشرة أحدث جلبها التطبيق
            boolean runnerNewer = Double.isNaN(s.usdBuy)
                || (rPost > 0 && s.postAt > 0 ? (rPost > s.postAt || (rPost == s.postAt && rAt >= s.at)) : rAt >= s.at);
            if (runnerNewer) {
                JSONObject prevBg = appJson(c, "prevBgUsd");
                double ref = prevBg != null ? optNum(prevBg, "buy") : s.usdBuy;
                applyRatesJson(s, r, ref);
                if (rAt > 0) s.at = rAt;
                if (rPost > 0) s.postAt = rPost;
            }
        }
        return Double.isNaN(s.usdBuy) ? null : s;
    }

    public static String fmt(double v, int dec) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "—";
        DecimalFormat f = new DecimalFormat(dec > 0 ? "#,##0.##" : "#,##0", DecimalFormatSymbols.getInstance(Locale.US));
        return f.format(v);
    }

    public static String fmtUsd(double v, int dec) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "—";
        return "$" + fmt(v, dec);
    }

    public static String timeOf(long ms) {
        if (ms <= 0) return "—";
        SimpleDateFormat f = new SimpleDateFormat("h:mm", Locale.US);
        f.setTimeZone(DAMASCUS);
        return f.format(new Date(ms));
    }

    public static String widgetTimeLabel(Snapshot s, boolean compact) {
        if (s == null) return compact ? "—" : "اضغط ↻ للتحديث";
        long ref = s.postAt > 0 ? s.postAt : s.at;
        if (ref <= 0) return "—";
        long ageH = (System.currentTimeMillis() - ref) / 3600_000L;
        if (ageH >= 12) return compact ? ("قديم " + ageH + "س") : ("نشرة قديمة · " + timeOf(ref));
        return compact ? timeOf(ref) : ((s.postAt > 0 ? "نشرة " : "تحديث ") + timeOf(ref));
    }
}
