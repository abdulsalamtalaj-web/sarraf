package com.liraconverter.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * مصدر البيانات المشترك بين الويدجت والإشعار الصباحي.
 * - "sarraf_native": ما يكتبه التطبيق (العملات المفعّلة بترتيب المستخدم + آخر أسعار + نص الإشعار)
 * - "com.liraconverter.app.daily": مخزن الـ Background Runner (CapacitorKV) — آخر أسعار جلبها بالخلفية
 * نأخذ الأرقام من الأحدث، والترتيب والأسماء دائماً من التطبيق.
 */
public final class SarrafData {
    public static final String PREFS = "sarraf_native";
    public static final String RUNNER_PREFS = "com.liraconverter.app.daily";
    // سوريا على UTC+3 طوال السنة (بدون توقيت صيفي منذ 2022) — إزاحة ثابتة بدل قاعدة tz القديمة ببعض الأجهزة
    public static final TimeZone DAMASCUS = TimeZone.getTimeZone("GMT+03:00");

    private SarrafData() {}

    public static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    public static SharedPreferences runner(Context c) { return c.getSharedPreferences(RUNNER_PREFS, Context.MODE_PRIVATE); }

    /** قيمة KV من الـ runner مخزنة كنص JSON */
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

    public static long parseIso(String iso) {
        if (iso == null) return 0;
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(iso.substring(0, 19)).getTime();
        } catch (Exception e) { return 0; }
    }

    public static class Row {
        public String key, label;
        public double value = Double.NaN;
    }

    /** ملخص للويدجت */
    public static class Snapshot {
        public List<Row> rows = new ArrayList<>();
        public double usd = Double.NaN;  // الدولار بالليرة الجديدة (حسب الشراء/المبيع المختار)
        public int usdDir = 0;            // 1 طلوع، -1 نزول، 0 ثابت
        public double g21 = Double.NaN;
        public boolean goldOn = true;
        public long at = 0;
    }

    static double pick(JSONObject pair, String mode) {
        if (pair == null) return Double.NaN;
        return pair.optDouble(mode, pair.optDouble("buy", Double.NaN));
    }

    /** قيمة مفتاح (usd_syp / try_syp / eur_syp / sar_syp ...) من نتيجة الأسعار */
    static double valueOf(JSONObject r, String key, String mode) {
        JSONObject p = r.optJSONObject(key);
        if (p == null) {
            JSONObject remit = r.optJSONObject("remit");
            if (remit != null) p = remit.optJSONObject(key);
        }
        return pick(p, mode);
    }

    public static Snapshot latest(Context c) {
        JSONObject w = appJson(c, "widget");
        JSONObject r = runnerJson(c, "lastRates");
        if (w == null && r == null) return null;
        Snapshot s = new Snapshot();
        String mode = "buy";
        if (w != null) {
            mode = w.optString("mode", "buy");
            s.at = w.optLong("at", 0);
            s.usd = w.optDouble("usd", Double.NaN);
            s.usdDir = w.optInt("usdDir", 0);
            s.g21 = w.optDouble("g21", Double.NaN);
            s.goldOn = w.optBoolean("goldOn", true);
            JSONArray rows = w.optJSONArray("rows");
            if (rows != null) for (int i = 0; i < rows.length(); i++) {
                JSONObject o = rows.optJSONObject(i);
                if (o == null) continue;
                Row row = new Row();
                row.key = o.optString("key");
                row.label = o.optString("label");
                row.value = o.optDouble("value", Double.NaN);
                s.rows.add(row);
            }
        } else {
            // التطبيق ما كتب شي بعد: الدولار بس
            Row row = new Row();
            row.key = "usd_syp"; row.label = "الدولار";
            s.rows.add(row);
        }
        // أسعار الخلفية أحدث؟ منحدّث الأرقام ومنحافظ على ترتيب التطبيق
        if (r != null) {
            long rAt = parseIso(r.optString("fetched", null));
            if (rAt > s.at) {
                double newUsd = valueOf(r, "usd_syp", mode);
                if (!Double.isNaN(newUsd) && !Double.isNaN(s.usd)) s.usdDir = Double.compare(newUsd, s.usd);
                if (!Double.isNaN(newUsd)) s.usd = newUsd;
                for (Row row : s.rows) {
                    double v = valueOf(r, row.key, mode);
                    if (!Double.isNaN(v)) row.value = v;
                }
                JSONObject gold = r.optJSONObject("gold");
                if (gold != null) {
                    JSONObject syp = gold.optJSONObject("syp");
                    JSONObject gusd = gold.optJSONObject("usd");
                    if (syp != null && syp.has("21")) s.g21 = syp.optDouble("21");
                    else if (gusd != null && gusd.has("21") && !Double.isNaN(s.usd)) s.g21 = gusd.optDouble("21") * s.usd;
                }
                s.at = rAt;
            }
        }
        return s;
    }

    public static String fmt(double v, int dec) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "—";
        DecimalFormat f = new DecimalFormat(dec > 0 ? "#,##0.##" : "#,##0", DecimalFormatSymbols.getInstance(Locale.US));
        return f.format(v);
    }

    public static String timeOf(long ms) {
        if (ms <= 0) return "—";
        SimpleDateFormat f = new SimpleDateFormat("h:mm", Locale.US);
        f.setTimeZone(DAMASCUS);
        return f.format(new Date(ms));
    }
}
