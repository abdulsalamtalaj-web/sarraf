package com.liraconverter.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * مهمة خلفية أصلية عبر WorkManager تعمل كل 15 دقيقة تلقائياً عند توفر الإنترنت
 * دون إجبار المستخدم على فتح التطبيق:
 * 1) إذا كان رابط الخادم المركزي (apiUrl) مضبوطاً، تجلب أحدث نشرة مباشرة وتخزّنها للويدجت وللتطبيق.
 * 2) وتدفع أي أسعار جديدة (سواء من الخادم أو من الـ Background Runner) فوراً إلى الويدجت (2×1 و 4×2).
 */
public class RatesSyncWorker extends Worker {
    private static final String TAG = "SarrafSync";
    public static final String WORK_NAME = "sarraf_rates_bg_sync";

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

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        try {
            JSONObject settings = SarrafData.runnerJson(c, "settings");
            String apiUrl = settings == null ? "" : settings.optString("apiUrl", "").trim();
            if (apiUrl.startsWith("https://")) {
                fetchFromWorker(c, apiUrl);
            }
            // ادفع أحدث الأسعار (سواء من الخادم أو من daily-runner) فوراً إلى الويدجت
            RatesWidget.updateAll(c);
            return Result.success();
        } catch (Exception e) {
            Log.w(TAG, "bg sync failed", e);
            // حتى عند فشل الشبكة، حدّث عرض الويدجت ليعكس عمر النشرة الحالي
            try { RatesWidget.updateAll(c); } catch (Exception ignored) { }
            return Result.retry();
        }
    }

    private void fetchFromWorker(Context c, String apiUrl) throws Exception {
        String sep = apiUrl.contains("?") ? "&" : "?";
        HttpURLConnection con = (HttpURLConnection) new URL(apiUrl + sep + "bg=1").openConnection();
        try {
            con.setConnectTimeout(12000);
            con.setReadTimeout(15000);
            con.setRequestProperty("Accept", "application/json");
            int code = con.getResponseCode();
            if (code != 200) throw new Exception("HTTP " + code);
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }
            JSONObject fresh = new JSONObject(sb.toString());
            if (!fresh.has("usd_syp")) return;

            JSONObject prev = SarrafData.runnerJson(c, "lastRates");
            if (!fresh.has("gold") && prev != null && prev.has("gold")) {
                fresh.put("gold", prev.get("gold"));
            }
            // نحفظ آخر سعر دولار سابق للمقارنة الدقيقة بسهم الويدجت
            if (prev != null && prev.has("usd_syp")) {
                JSONObject prevUsd = prev.optJSONObject("usd_syp");
                JSONObject curUsd = fresh.optJSONObject("usd_syp");
                if (prevUsd != null && curUsd != null
                    && (prevUsd.optDouble("buy") != curUsd.optDouble("buy") || prevUsd.optDouble("sell") != curUsd.optDouble("sell"))) {
                    SarrafData.prefs(c).edit().putString("prevBgUsd", prevUsd.toString()).apply();
                }
            }
            SarrafData.runner(c).edit().putString("lastRates", fresh.toString()).apply();
        } finally {
            con.disconnect();
        }
    }
}
