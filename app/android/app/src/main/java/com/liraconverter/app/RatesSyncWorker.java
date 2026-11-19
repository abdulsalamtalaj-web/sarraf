package com.liraconverter.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * مهمة خلفية أصلية عبر WorkManager تعمل كل 15 دقيقة تلقائياً (وعند ضغط ↻ على أي ويدجت):
 * 1) تجلب أحدث الأسعار (من الخادم المركزي أو مباشرة من تلغرام + gold-api كاحتياط) وتحدّث جميع الويدجتات فوراً.
 * 2) تفحص version.json كل 6 ساعات وترسل إشعاراً تلقائياً لكل المستخدمين عند صدور تحديث جديد!
 */
public class RatesSyncWorker extends Worker {
    private static final String TAG = "SarrafSync";
    public static final String WORK_NAME = "sarraf_rates_bg_sync";
    public static final String WORK_NOW = "sarraf_rates_now";
    private static final String VERSION_URL = "https://abdulsalamtalaj-web.github.io/sarraf/version.json";
    private static final String UPDATE_CHANNEL = "updates";
    private static final int UPDATE_NOTIFY_ID = 980;
    private static final long UPDATE_CHECK_INTERVAL_MS = 6L * 3600_000L;

    public RatesSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void ensureScheduled(Context c) {
        try {
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
            PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(RatesSyncWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();
            WorkManager.getInstance(c.getApplicationContext())
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, req);
        } catch (Exception e) {
            Log.w(TAG, "schedule failed", e);
        }
    }

    /** تشغيل فوري عند ضغط زر ↻ على أي ويدجت */
    public static void triggerImmediateRefresh(Context c) {
        try {
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
            OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(RatesSyncWorker.class)
                .setConstraints(constraints)
                .build();
            WorkManager.getInstance(c.getApplicationContext())
                .enqueueUniqueWork(WORK_NOW, ExistingWorkPolicy.REPLACE, req);
        } catch (Exception e) {
            Log.w(TAG, "immediate refresh failed", e);
        }
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        try {
            JSONObject settings = SarrafData.runnerJson(c, "settings");
            String apiUrl = settings == null ? "" : settings.optString("apiUrl", "").trim();
            boolean ok = false;
            if (apiUrl.startsWith("https://")) {
                try { ok = fetchFromWorker(c, apiUrl); } catch (Exception e) { Log.w(TAG, "worker fetch err", e); }
            }
            if (!ok) {
                try { fetchDirectFallback(c, settings); } catch (Exception e) { Log.w(TAG, "direct fallback err", e); }
            }
            RatesWidget.updateAll(c);
            // فحص التحديثات الجديدة وإرسال إشعار لكل المستخدمين عند صدور إصدار أحدث
            checkNewVersionAndNotify(c);
            return Result.success();
        } catch (Exception e) {
            Log.w(TAG, "bg sync failed", e);
            try { RatesWidget.updateAll(c); } catch (Exception ignored) { }
            return Result.retry();
        }
    }

    private String httpGet(String urlStr) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(urlStr).openConnection();
        try {
            con.setConnectTimeout(12000);
            con.setReadTimeout(15000);
            con.setRequestProperty("User-Agent", "Mozilla/5.0 (compatible; Sarraf/3.4)");
            int code = con.getResponseCode();
            if (code != 200) throw new Exception("HTTP " + code);
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line).append('\n');
            }
            return sb.toString();
        } finally {
            con.disconnect();
        }
    }

    private void saveFreshRates(Context c, JSONObject fresh) {
        try {
            JSONObject prev = SarrafData.runnerJson(c, "lastRates");
            if (!fresh.has("gold") && prev != null && prev.has("gold")) {
                fresh.put("gold", prev.get("gold"));
            }
            if (prev != null && prev.has("usd_syp")) {
                JSONObject prevUsd = prev.optJSONObject("usd_syp");
                JSONObject curUsd = fresh.optJSONObject("usd_syp");
                if (prevUsd != null && curUsd != null
                    && (prevUsd.optDouble("buy") != curUsd.optDouble("buy") || prevUsd.optDouble("sell") != curUsd.optDouble("sell"))) {
                    SarrafData.prefs(c).edit().putString("prevBgUsd", prevUsd.toString()).apply();
                }
            }
            SarrafData.runner(c).edit().putString("lastRates", fresh.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "saveFreshRates failed", e);
        }
    }

    private boolean fetchFromWorker(Context c, String apiUrl) throws Exception {
        String sep = apiUrl.contains("?") ? "&" : "?";
        JSONObject fresh = new JSONObject(httpGet(apiUrl + sep + "bg=1"));
        if (!fresh.has("usd_syp")) return false;
        saveFreshRates(c, fresh);
        return true;
    }

    /** جلب احتياطي مباشر للويدجت عندما لا يكون رابط الخادم المركزي مضبوطاً بعد */
    private void fetchDirectFallback(Context c, JSONObject settings) throws Exception {
        String ch = "exchange_Currencyy";
        if (settings != null) {
            JSONArray arr = settings.optJSONArray("channels");
            if (arr != null && arr.length() > 0 && !arr.optString(0).isEmpty()) ch = arr.optString(0);
        }
        String html = httpGet("https://t.me/s/" + ch);
        String[] blocks = html.split("tgme_widget_message_wrap");
        JSONObject found = null;
        for (int i = blocks.length - 1; i >= 1; i--) {
            String blk = blocks[i];
            Matcher tm = Pattern.compile("<time[^>]*datetime=\"([^\"]+)\"").matcher(blk);
            String postTime = tm.find() ? tm.group(1) : null;
            Matcher mm = Pattern.compile("<div class=\"tgme_widget_message_text[^\"]*\"[^>]*>([\\s\\S]*?)</div>").matcher(blk);
            if (!mm.find()) continue;
            String text = mm.group(1).replaceAll("<br\\s*/?>", "\n").replaceAll("<[^>]+>", " ").replace("&nbsp;", " ");
            JSONObject parsed = parseQuickBulletin(text);
            if (parsed != null && parsed.has("usd_syp")) {
                if (postTime != null) parsed.put("post_time", postTime);
                parsed.put("source", ch);
                parsed.put("source_kind", "telegram");
                found = parsed;
                break;
            }
        }
        if (found == null) return;

        // جلب الأونصة العالمية لحساب الذهب بالدولار
        try {
            JSONObject gApi = new JSONObject(httpGet("https://api.gold-api.com/price/XAU"));
            double oz = gApi.optDouble("price", Double.NaN);
            if (!Double.isNaN(oz) && oz > 500 && oz < 20000) {
                double g24 = oz / 31.1034768;
                double g21 = g24 * 21.0 / 24.0;
                double g18 = g24 * 18.0 / 24.0;
                JSONObject gusd = new JSONObject();
                gusd.put("24", Math.round(g24 * 100.0) / 100.0);
                gusd.put("21", Math.round(g21 * 100.0) / 100.0);
                gusd.put("18", Math.round(g18 * 100.0) / 100.0);
                gusd.put("lira", Math.round(g21 * 8.0 * 100.0) / 100.0);
                JSONObject gold = new JSONObject();
                gold.put("ounce_usd", Math.round(oz * 100.0) / 100.0);
                gold.put("usd", gusd);
                gold.put("is_local", false);
                gold.put("estimated", true);
                gold.put("ounce_time", isoNow());
                gold.put("source", "gold-api");
                found.put("gold", gold);
            }
        } catch (Exception ignored) { }

        found.put("fetched", isoNow());
        saveFreshRates(c, found);
    }

    private static JSONObject parseQuickBulletin(String text) {
        try {
            String norm = normalizeArabicDigits(text);
            JSONObject out = new JSONObject();
            String cur = null;
            double[] usd = { Double.NaN, Double.NaN }, tr = { Double.NaN, Double.NaN }, eur = { Double.NaN, Double.NaN };
            for (String raw : norm.split("\n")) {
                String l = raw.trim();
                if (l.isEmpty()) continue;
                if (l.contains("دولار") && !l.contains("ترك")) cur = "usd";
                else if (l.contains("ترك")) cur = "try";
                else if (l.contains("يورو")) cur = "eur";
                else if (l.contains("ريال") || l.contains("درهم") || l.contains("دينار") || l.contains("ذهب")) cur = null;
                if (cur == null) continue;
                double[] target = "usd".equals(cur) ? usd : "try".equals(cur) ? tr : eur;
                if (l.contains("شراء") || l.contains("مبيع") || l.contains("بيع")) {
                    Matcher nb = Pattern.compile("(?:شراء|الشراء)[^\\d]*(\\d+(?:[.,]\\d+)?)").matcher(l);
                    if (nb.find() && Double.isNaN(target[0])) target[0] = parseNum(nb.group(1));
                    Matcher ns = Pattern.compile("(?:مبيع|المبيع|بيع)[^\\d]*(\\d+(?:[.,]\\d+)?)").matcher(l);
                    if (ns.find() && Double.isNaN(target[1])) target[1] = parseNum(ns.group(1));
                }
            }
            if (validPair(usd, 30, 2000)) out.put("usd_syp", pairObj(usd, 2000));
            if (validPair(tr, 0.5, 80)) out.put("try_syp", pairObj(tr, 80));
            if (validPair(eur, 30, 2500)) out.put("eur_syp", pairObj(eur, 2500));
            if (out.has("usd_syp") && out.has("try_syp")) {
                JSONObject u = out.getJSONObject("usd_syp"), t = out.getJSONObject("try_syp");
                JSONObject ut = new JSONObject();
                ut.put("buy", Math.round((u.getDouble("buy") / t.getDouble("sell")) * 100.0) / 100.0);
                ut.put("sell", Math.round((u.getDouble("sell") / t.getDouble("buy")) * 100.0) / 100.0);
                out.put("try_usd", ut);
            }
            return out.has("usd_syp") ? out : null;
        } catch (Exception e) { return null; }
    }

    private static boolean validPair(double[] p, double min, double max) {
        if (Double.isNaN(p[0]) || Double.isNaN(p[1]) || p[0] > p[1]) return false;
        double b = p[0] > max ? p[0] / 100.0 : p[0];
        double s = p[1] > max ? p[1] / 100.0 : p[1];
        return b >= min && s <= max;
    }

    private static JSONObject pairObj(double[] p, double max) throws Exception {
        double b = p[0] > max ? p[0] / 100.0 : p[0];
        double s = p[1] > max ? p[1] / 100.0 : p[1];
        JSONObject o = new JSONObject();
        o.put("buy", Math.round(b * 100.0) / 100.0);
        o.put("sell", Math.round(s * 100.0) / 100.0);
        return o;
    }

    private static double parseNum(String s) {
        String t = s.replace(",", ".");
        if (t.matches("\\d{1,2}\\.\\d{3}")) return Double.parseDouble(t.replace(".", ""));
        return Double.parseDouble(t);
    }

    private static String normalizeArabicDigits(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch >= '\u0660' && ch <= '\u0669') sb.append((char) ('0' + (ch - '\u0660')));
            else if (ch >= '\u06F0' && ch <= '\u06F9') sb.append((char) ('0' + (ch - '\u06F0')));
            else if (ch == '\u066B') sb.append('.');
            else if (ch == '\u066C') sb.append(',');
            else sb.append(ch);
        }
        return sb.toString();
    }

    private static String isoNow() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    /** فحص وجود إصدار أحدث وإرسال إشعار نظام لكل المستخدمين مرة واحدة لكل إصدار */
    private void checkNewVersionAndNotify(Context c) {
        try {
            long lastCheck = SarrafData.prefs(c).getLong("lastUpdCheckAt", 0);
            if (System.currentTimeMillis() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
            SarrafData.prefs(c).edit().putLong("lastUpdCheckAt", System.currentTimeMillis()).apply();

            JSONObject v = new JSONObject(httpGet(VERSION_URL + "?t=" + System.currentTimeMillis()));
            long remoteVc = v.optLong("versionCode", 0);
            long myVc = PackageInfoCompat.getLongVersionCode(c.getPackageManager().getPackageInfo(c.getPackageName(), 0));
            if (remoteVc <= myVc) return;

            long lastNotifiedVc = SarrafData.prefs(c).getLong("lastNotifiedVc", 0);
            if (lastNotifiedVc == remoteVc) return;

            String verName = v.optString("versionName", "");
            String notes = v.optString("notes", "تحسينات وإصلاحات جديدة لتطبيق صرّاف.").trim();
            if (notes.length() > 160) notes = notes.substring(0, 160) + "…";

            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager nm = c.getSystemService(NotificationManager.class);
                if (nm != null && nm.getNotificationChannel(UPDATE_CHANNEL) == null) {
                    NotificationChannel ch = new NotificationChannel(UPDATE_CHANNEL, "تحديثات صرّاف", NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription("تنبيه عند صدور إصدار جديد من تطبيق صرّاف");
                    nm.createNotificationChannel(ch);
                }
            }

            Intent open = new Intent(c, MainActivity.class);
            open.putExtra("openUpdate", true);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, UPDATE_NOTIFY_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            NotificationCompat.Builder b = new NotificationCompat.Builder(c, UPDATE_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_sarraf)
                .setColor(0xFFF5C542)
                .setContentTitle("✨ إصدار جديد من صرّاف " + verName)
                .setContentText("اضغط لتنزيل وتثبيت التحديث الجديد الآن")
                .setStyle(new NotificationCompat.BigTextStyle().bigText(notes + "\n\nاضغط لتنزيل وتثبيت الإصدار الجديد."))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pi);

            try {
                NotificationManagerCompat.from(c).notify(UPDATE_NOTIFY_ID, b.build());
                SarrafData.prefs(c).edit().putLong("lastNotifiedVc", remoteVc).apply();
            } catch (SecurityException ignored) { }
        } catch (Exception e) {
            Log.w(TAG, "update check failed", e);
        }
    }
}
