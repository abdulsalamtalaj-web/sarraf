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
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
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
            con.setUseCaches(false);
            con.setConnectTimeout(8000);
            con.setReadTimeout(10000);
            con.setRequestProperty("Cache-Control", "no-cache");
            con.setRequestProperty("User-Agent", "Mozilla/5.0 (compatible; Sarraf/3.5)");
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
            if (prev != null) {
                long prevPost = SarrafData.parseIso(prev.optString("post_time", null));
                long newPost = SarrafData.parseIso(fresh.optString("post_time", null));
                // لا نكتب نشرة أقدم فوق نشرة أحدث محفوظة
                if (prevPost > 0 && newPost > 0 && newPost < prevPost) return;
                if (!fresh.has("gold") && prev.has("gold")) {
                    JSONObject prevGold = prev.optJSONObject("gold");
                    if (prevGold != null && !"gold-api".equals(prevGold.optString("source"))) {
                        fresh.put("gold", prevGold);
                    }
                }
                if (!fresh.has("remit") && prev.has("remit")) {
                    fresh.put("remit", prev.get("remit"));
                }
                if (prev.has("usd_syp")) {
                    JSONObject prevUsd = prev.optJSONObject("usd_syp");
                    JSONObject curUsd = fresh.optJSONObject("usd_syp");
                    if (prevUsd != null && curUsd != null
                        && (prevUsd.optDouble("buy") != curUsd.optDouble("buy") || prevUsd.optDouble("sell") != curUsd.optDouble("sell"))) {
                        SarrafData.prefs(c).edit().putString("prevBgUsd", prevUsd.toString()).apply();
                    }
                }
            }
            SarrafData.runner(c).edit().putString("lastRates", fresh.toString()).apply();
        } catch (Exception e) {
            Log.w(TAG, "saveFreshRates failed", e);
        }
    }

    private boolean fetchFromWorker(Context c, String apiUrl) throws Exception {
        String sep = apiUrl.contains("?") ? "&" : "?";
        JSONObject fresh = new JSONObject(httpGet(apiUrl + sep + "bg=1&_t=" + System.currentTimeMillis()));
        if (!fresh.has("usd_syp")) return false;
        saveFreshRates(c, fresh);
        return true;
    }

    /** جلب احتياطي مباشر من قنوات تلغرام (العملات + الذهب من النشرة نفسها، بلا البورصة العالمية) */
    private void fetchDirectFallback(Context c, JSONObject settings) throws Exception {
        List<String> channels = new ArrayList<>();
        if (settings != null) {
            JSONArray arr = settings.optJSONArray("channels");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    String s = arr.optString(i, "").trim().replaceFirst("^@", "");
                    if (!s.isEmpty()) channels.add(s);
                }
            }
        }
        if (channels.isEmpty()) {
            channels.add("exchange_Currencyy");
            channels.add("aboothman33");
        }

        JSONObject bestRates = null;
        long bestRatesPost = 0;
        JSONObject bestGold = null;
        long bestGoldPost = 0;
        long bust = System.currentTimeMillis();

        for (String ch : channels) {
            try {
                String html = httpGet("https://t.me/s/" + ch + "?_t=" + bust);
                String[] blocks = html.split("tgme_widget_message_wrap");
                JSONObject chRates = null;
                long chRatesPost = 0;
                JSONObject chGold = null;
                long chGoldPost = 0;

                for (int i = blocks.length - 1; i >= 1; i--) {
                    String blk = blocks[i];
                    Matcher tm = Pattern.compile("<time[^>]*datetime=\"([^\"]+)\"").matcher(blk);
                    String postTime = tm.find() ? tm.group(1) : null;
                    long postMs = SarrafData.parseIso(postTime);
                    Matcher mm = Pattern.compile("<div class=\"tgme_widget_message_text[^\"]*\"[^>]*>([\\s\\S]*?)</div>").matcher(blk);
                    if (!mm.find()) continue;
                    String text = decodeHtml(mm.group(1));

                    if (chRates == null) {
                        JSONObject parsed = parseQuickBulletin(text);
                        if (parsed != null && parsed.has("usd_syp")) {
                            if (postTime != null) parsed.put("post_time", postTime);
                            parsed.put("source", ch);
                            parsed.put("source_kind", "telegram");
                            chRates = parsed;
                            chRatesPost = postMs;
                        }
                    }
                    if (chGold == null) {
                        JSONObject parsedGold = parseQuickGold(text, postTime, ch);
                        if (parsedGold != null) {
                            chGold = parsedGold;
                            chGoldPost = postMs;
                        }
                    }
                    if (chRates != null && chGold != null) break;
                }

                if (chRates != null && (bestRates == null || chRatesPost > bestRatesPost)) {
                    bestRates = chRates;
                    bestRatesPost = chRatesPost;
                }
                if (chGold != null && (bestGold == null || chGoldPost > bestGoldPost)) {
                    bestGold = chGold;
                    bestGoldPost = chGoldPost;
                }
            } catch (Exception e) {
                Log.w(TAG, "tg channel fetch err " + ch, e);
            }
        }

        if (bestRates == null) return;
        if (bestGold != null) {
            finalizeGoldWithUsd(bestGold, bestRates.getJSONObject("usd_syp"));
            bestRates.put("gold", bestGold);
        }
        bestRates.put("fetched", isoNow());
        saveFreshRates(c, bestRates);
    }

    private static String decodeHtml(String h) {
        return h
            .replaceAll("<br\\s*/?>", "\n")
            .replaceAll("</(?:p|div)>", "\n")
            .replaceAll("<[^>]+>", " ")
            .replace("&#036;", "$")
            .replace("&#36;", "$")
            .replace("&nbsp;", " ")
            .replace("&rlm;", "")
            .replace("&lrm;", "")
            .replace("&amp;", "&");
    }

    private static JSONObject parseQuickGold(String text, String postTime, String channel) {
        try {
            String norm = normalizeArabicDigits(text);
            if (!norm.contains("ذهب") && !norm.contains("عيار")) return null;
            boolean sectionUsd = norm.contains("الذهب بالدولار") || norm.contains("$");
            double g21Buy = Double.NaN, g21Sell = Double.NaN;
            double g24Buy = Double.NaN, g24Sell = Double.NaN;
            double g18Buy = Double.NaN, g18Sell = Double.NaN;
            boolean g21Syp = false, g24Syp = false, g18Syp = false;
            double ounce = Double.NaN;
            String curK = null;

            for (String raw : norm.split("\n")) {
                String l = raw.trim();
                if (l.isEmpty()) continue;
                boolean isGoldLine = l.contains("ذهب") || l.contains("عيار");
                if (!isGoldLine && (l.contains("فضة") || l.contains("فضه") || l.contains("يورو") || l.contains("ريال")
                    || l.contains("برنت") || l.contains("نفط") || l.contains("بيتكوين") || l.contains("━"))) {
                    curK = null;
                    continue;
                }
                if ((l.contains("أونص") || l.contains("اونص")) && l.contains("ذهب")) {
                    curK = null;
                    Matcher om = Pattern.compile("(\\d+(?:[.,]\\d+)?)").matcher(l);
                    if (om.find()) {
                        double v = parseNum(om.group(1));
                        if (v > 500 && v < 20000) ounce = v;
                    }
                    continue;
                }
                Matcher km = Pattern.compile("عيار\\s*(24|21|18)\\b").matcher(l);
                if (km.find() && !l.contains("أونص") && !l.contains("اونص")) {
                    curK = km.group(1);
                    String after = l.substring(km.end());
                    boolean isSyp = l.contains("ل.س") || l.contains("سوري") || (!l.contains("$") && !l.contains("دولار") && !sectionUsd);
                    boolean hasBS = after.contains("شراء") || after.contains("مبيع") || after.contains("بيع");
                    if (hasBS) {
                        Matcher nb = Pattern.compile("(?:شراء|الشراء)[^\\d]*(\\d+(?:[.,]\\d+)?)").matcher(after);
                        Matcher ns = Pattern.compile("(?:مبيع|المبيع|بيع)[^\\d]*(\\d+(?:[.,]\\d+)?)").matcher(after);
                        double vb = nb.find() ? parseNum(nb.group(1)) : Double.NaN;
                        double vs = ns.find() ? parseNum(ns.group(1)) : Double.NaN;
                        if ("21".equals(curK)) { if (!Double.isNaN(vb)) g21Buy = vb; if (!Double.isNaN(vs)) g21Sell = vs; g21Syp = isSyp && (vb > 5000 || vs > 5000 || l.contains("ل.س")); }
                        else if ("24".equals(curK)) { if (!Double.isNaN(vb)) g24Buy = vb; if (!Double.isNaN(vs)) g24Sell = vs; g24Syp = isSyp && (vb > 5000 || vs > 5000 || l.contains("ل.س")); }
                        else if ("18".equals(curK)) { if (!Double.isNaN(vb)) g18Buy = vb; if (!Double.isNaN(vs)) g18Sell = vs; g18Syp = isSyp && (vb > 5000 || vs > 5000 || l.contains("ل.س")); }
                    } else {
                        Matcher nm = Pattern.compile("(\\d+(?:[.,]\\d+)*)").matcher(after);
                        if (nm.find()) {
                            double v = parseNum(nm.group(1));
                            boolean syp = l.contains("ل.س") || l.contains("سوري") || (!l.contains("$") && !l.contains("دولار") && v > 5000);
                            if ("21".equals(curK)) { g21Buy = v; g21Sell = v; g21Syp = syp; }
                            else if ("24".equals(curK)) { g24Buy = v; g24Sell = v; g24Syp = syp; }
                            else if ("18".equals(curK)) { g18Buy = v; g18Sell = v; g18Syp = syp; }
                            curK = null;
                        }
                    }
                    continue;
                }
                if (curK != null && (l.contains("شراء") || l.contains("مبيع") || l.contains("بيع"))) {
                    Matcher nb = Pattern.compile("(?:شراء|الشراء)[^\\d]*(\\d+(?:[.,]\\d+)*)").matcher(l);
                    Matcher ns = Pattern.compile("(?:مبيع|المبيع|بيع)[^\\d]*(\\d+(?:[.,]\\d+)*)").matcher(l);
                    double vb = nb.find() ? parseNum(nb.group(1)) : Double.NaN;
                    double vs = ns.find() ? parseNum(ns.group(1)) : Double.NaN;
                    boolean syp = l.contains("ل.س") || l.contains("سوري") || (!l.contains("$") && !l.contains("دولار") && !sectionUsd && (vb > 5000 || vs > 5000));
                    if ("21".equals(curK)) { if (!Double.isNaN(vb)) g21Buy = vb; if (!Double.isNaN(vs)) g21Sell = vs; g21Syp = syp; }
                    else if ("24".equals(curK)) { if (!Double.isNaN(vb)) g24Buy = vb; if (!Double.isNaN(vs)) g24Sell = vs; g24Syp = syp; }
                    else if ("18".equals(curK)) { if (!Double.isNaN(vb)) g18Buy = vb; if (!Double.isNaN(vs)) g18Sell = vs; g18Syp = syp; }
                }
            }

            boolean hasGram = !Double.isNaN(g21Buy) || !Double.isNaN(g21Sell) || !Double.isNaN(g24Buy) || !Double.isNaN(g24Sell) || !Double.isNaN(g18Buy) || !Double.isNaN(g18Sell);
            if (!hasGram && Double.isNaN(ounce)) return null;

            JSONObject gold = new JSONObject();
            if (!Double.isNaN(ounce)) gold.put("ounce_usd", round2(ounce));
            gold.put("is_local", hasGram);
            gold.put("estimated", !hasGram);
            if (postTime != null) gold.put("post_time", postTime);
            gold.put("source", channel);
            gold.put("source_kind", "telegram");

            if (!g21Syp && (!Double.isNaN(g21Sell) || !Double.isNaN(g21Buy))) {
                double s21 = Double.isNaN(g21Sell) ? g21Buy : g21Sell;
                double b21 = Double.isNaN(g21Buy) ? g21Sell : g21Buy;
                if (b21 > s21) { double t = b21; b21 = s21; s21 = t; }
                gold.put("usd", buildKaratMap(s21, Double.isNaN(g24Sell) ? Double.NaN : g24Sell, Double.isNaN(g18Sell) ? Double.NaN : g18Sell));
                if (b21 != s21) gold.put("usd_buy", buildKaratMap(b21, Double.isNaN(g24Buy) ? Double.NaN : g24Buy, Double.isNaN(g18Buy) ? Double.NaN : g18Buy));
            } else if (g21Syp && (!Double.isNaN(g21Sell) || !Double.isNaN(g21Buy))) {
                double s21 = Double.isNaN(g21Sell) ? g21Buy : g21Sell;
                gold.put("_raw_syp21", s21);
            } else if (!Double.isNaN(ounce)) {
                double g24 = ounce / 31.1034768;
                gold.put("usd", buildKaratMap(g24 * 21.0 / 24.0, g24, g24 * 18.0 / 24.0));
            }
            return gold;
        } catch (Exception e) {
            return null;
        }
    }

    private static void finalizeGoldWithUsd(JSONObject gold, JSONObject usdSyp) throws Exception {
        double usdSell = usdSyp.optDouble("sell", Double.NaN);
        if (gold.has("_raw_syp21") && !Double.isNaN(usdSell) && usdSell > 0) {
            double raw = gold.optDouble("_raw_syp21", Double.NaN);
            gold.remove("_raw_syp21");
            if (!Double.isNaN(raw)) {
                if (raw / usdSell > 2000) raw = raw / 100.0;
                gold.put("syp", buildKaratMap(raw, Double.NaN, Double.NaN));
                gold.put("usd", buildKaratMap(raw / usdSell, Double.NaN, Double.NaN));
            }
        }
    }

    private static JSONObject buildKaratMap(double k21, double k24, double k18) throws Exception {
        double base24 = !Double.isNaN(k21) ? (k21 * 24.0 / 21.0) : !Double.isNaN(k24) ? k24 : (k18 * 24.0 / 18.0);
        double v21 = !Double.isNaN(k21) ? k21 : base24 * 21.0 / 24.0;
        double v24 = !Double.isNaN(k24) ? k24 : base24;
        double v18 = !Double.isNaN(k18) ? k18 : base24 * 18.0 / 24.0;
        JSONObject m = new JSONObject();
        m.put("21", round2(v21));
        m.put("24", round2(v24));
        m.put("18", round2(v18));
        m.put("lira", round2(v21 * 8.0));
        return m;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
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
                boolean hasSyp = l.contains("سوري") || l.contains("ل.س") || l.contains("SYP");
                boolean hasUsd = l.contains("دولار") || l.contains("USD") || l.contains("$");
                boolean hasTr = l.contains("ترك") || l.contains("TRY");
                boolean hasEur = l.contains("يورو") || l.contains("EUR");
                boolean hasOther = l.contains("ريال") || l.contains("درهم") || l.contains("دينار") || l.contains("ذهب")
                    || l.contains("عيار") || l.contains("فضة") || l.contains("فضه") || l.contains("برنت")
                    || l.contains("نفط") || l.contains("بيتكوين") || l.contains("أونص") || l.contains("اونص");
                if (hasOther) { cur = null; continue; }
                // تجاهل أزواج مثل "اليورو مقابل الدولار" أو "الدولار مقابل التركي" عندما لا تُذكر الليرة السورية
                if (hasEur && hasUsd && !hasSyp) { cur = null; continue; }
                if (hasTr && hasUsd && !hasSyp) { cur = null; continue; }
                if (hasTr) cur = "try";
                else if (hasEur) cur = "eur";
                else if (hasUsd) cur = "usd";
                if (cur == null) continue;
                double[] target = "usd".equals(cur) ? usd : "try".equals(cur) ? tr : eur;
                if (l.contains("شراء") || l.contains("مبيع") || l.contains("بيع")) {
                    Matcher nb = Pattern.compile("(?:شراء|الشراء)[^\\d]*(\\d+(?:[.,]\\d+)*)").matcher(l);
                    if (nb.find() && Double.isNaN(target[0])) target[0] = parseNum(nb.group(1));
                    Matcher ns = Pattern.compile("(?:مبيع|المبيع|بيع)[^\\d]*(\\d+(?:[.,]\\d+)*)").matcher(l);
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
        if (s == null) return Double.NaN;
        boolean hasDot = s.contains("."), hasComma = s.contains(",");
        if (hasDot && hasComma) {
            int last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
            String dec = s.substring(last + 1);
            String intPart = s.substring(0, last).replaceAll("[.,]", "");
            return dec.length() == 3 ? Double.parseDouble(intPart + dec) : Double.parseDouble(intPart + "." + dec);
        }
        String sep = hasDot ? "\\." : hasComma ? "," : null;
        if (sep == null) return Double.parseDouble(s);
        String[] parts = s.split(sep);
        if (parts.length > 2) return Double.parseDouble(s.replaceAll("[.,]", ""));
        if (parts.length == 2 && parts[1].length() == 3 && !"0".equals(parts[0]) && parts[0].length() <= 3) {
            return Double.parseDouble(parts[0] + parts[1]);
        }
        return Double.parseDouble(parts[0] + "." + (parts.length > 1 ? parts[1] : "0"));
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
