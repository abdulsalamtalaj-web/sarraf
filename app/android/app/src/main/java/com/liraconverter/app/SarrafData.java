package com.liraconverter.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

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
 * مصدر البيانات المشترك بين الويدجت والإشعار الصباحي والمزامنة بالخلفية.
 */
public final class SarrafData {
    private static final String TAG = "SarrafData";
    public static final String PREFS = "sarraf_native";
    public static final String RUNNER_PREFS = "com.liraconverter.app.daily";
    // سوريا على UTC+3 طوال السنة (بدون توقيت صيفي منذ 2022)
    public static final TimeZone DAMASCUS = TimeZone.getTimeZone("GMT+03:00");

    private SarrafData() {}

    public static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    public static SharedPreferences runner(Context c) { return c.getSharedPreferences(RUNNER_PREFS, Context.MODE_PRIVATE); }

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

    /** تحليل ISO-8601 بدقة مع احترام فروق التوقيت (+03:00 / +00:00 / Z) */
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

    public static class Row {
        public String key, label;
        public double value = Double.NaN;
    }

    public static class Snapshot {
        public List<Row> rows = new ArrayList<>();
        public double usd = Double.NaN;
        public int usdDir = 0;
        public double g21 = Double.NaN;
        public boolean goldOn = true;
        public long at = 0;      // وقت الجلب
        public long postAt = 0;  // وقت النشرة الفعلي
    }

    static double pick(JSONObject pair, String mode) {
        if (pair == null) return Double.NaN;
        return pair.optDouble(mode, pair.optDouble("buy", Double.NaN));
    }

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
            s.postAt = w.optLong("postAt", 0);
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
            Row row = new Row();
            row.key = "usd_syp"; row.label = "الدولار";
            s.rows.add(row);
        }
        if (r != null) {
            long rAt = parseIso(r.optString("fetched", null));
            long rPost = parseIso(r.optString("post_time", null));
            if (rAt > s.at) {
                double newUsd = valueOf(r, "usd_syp", mode);
                JSONObject prevBg = appJson(c, "prevBgUsd");
                double refUsd = prevBg != null ? pick(prevBg, mode) : s.usd;
                if (!Double.isNaN(newUsd) && !Double.isNaN(refUsd)) s.usdDir = Double.compare(newUsd, refUsd);
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
                if (rPost > 0) s.postAt = rPost;
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

    /** نص قصير لعمر النشرة بالويدجت (يفصل النشرة القديمة عن الحديثة) */
    public static String widgetTimeLabel(Snapshot s, boolean compact) {
        if (s == null) return compact ? "" : "افتح التطبيق مرة";
        long ref = s.postAt > 0 ? s.postAt : s.at;
        if (ref <= 0) return "—";
        long ageH = (System.currentTimeMillis() - ref) / 3600_000L;
        if (ageH >= 12) return compact ? ("قديم " + ageH + "س") : ("نشرة قديمة · " + timeOf(ref));
        return compact ? timeOf(ref) : ((s.postAt > 0 ? "نشرة " : "تحديث ") + timeOf(ref));
    }
}
