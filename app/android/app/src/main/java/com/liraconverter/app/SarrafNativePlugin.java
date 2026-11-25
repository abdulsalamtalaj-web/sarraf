package com.liraconverter.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** جسر بين واجهة الويب وأندرويد: الويدجت، المزامنة بالخلفية، المنبّه الدقيق، وتحديث الـ APK/OTA */
@CapacitorPlugin(name = "SarrafNative")
public class SarrafNativePlugin extends Plugin {

    private static final AtomicBoolean APK_DOWNLOADING = new AtomicBoolean(false);
    private static final ExecutorService WIDGET_EXEC = Executors.newSingleThreadExecutor();
    private static final Set<String> ALLOWED_APK_HOSTS = new HashSet<>(Arrays.asList(
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com"
    ));

    private static File apkFile(Context c) {
        return new File(new File(c.getFilesDir(), "updates"), "sarraf.apk");
    }

    /** يتحقق إن كان المستخدم فتح التطبيق من إشعار "إصدار جديد" ويعيد تعيين العلم */
    @PluginMethod
    public void consumeOpenUpdate(PluginCall call) {
        Context c = getContext();
        boolean open = SarrafData.prefs(c).getBoolean("pendingOpenUpdate", false);
        if (open) SarrafData.prefs(c).edit().putBoolean("pendingOpenUpdate", false).apply();
        JSObject out = new JSObject();
        out.put("open", open);
        call.resolve(out);
    }

    /** فحص فوري (<1ms) لحالة اتصال الشبكة لمنع أي تجمّد عند فتح التطبيق بلا إنترنت */
    @PluginMethod
    public void isOnline(PluginCall call) {
        JSObject out = new JSObject();
        out.put("online", SarrafData.isNetworkAvailable(getContext()));
        call.resolve(out);
    }

    /** إرجاع أحدث أسعار تم جلبها في الخلفية فقط إذا كانت صالحة ومطابقة لإصدار المحلّل الجديد (يطهّر أي كاش قديم مسموم) */
    @PluginMethod
    public void getBackgroundRates(PluginCall call) {
        Context c = getContext();
        JSONObject r = SarrafData.runnerJson(c, "lastRates");
        if (r != null && !SarrafData.isSaneRates(r)) {
            SarrafData.runner(c).edit().remove("lastRates").apply();
            r = null;
        }
        JSObject out = new JSObject();
        out.put("ratesJson", r != null ? r.toString() : null);
        call.resolve(out);
    }

    /** حفظ النشرة السليمة التي جلبها التطبيق داخل كاش الخلفية لتوحيد المصدر بين التطبيق والويدجت */
    @PluginMethod
    public void syncRatesToBg(PluginCall call) {
        String raw = call.getString("ratesJson");
        if (raw != null && !raw.isEmpty()) {
            try {
                JSONObject obj = new JSONObject(raw);
                obj.put("parser_v", SarrafData.PARSER_VERSION);
                if (SarrafData.isSaneRates(obj)) {
                    SarrafData.runner(getContext()).edit().putString("lastRates", obj.toString()).apply();
                }
            } catch (Exception ignored) { }
        }
        call.resolve();
    }

    /** {rows:[{key,label,value}], usd, usdDir, g21, goldOn, mode, at, postAt} → الويدجتات (بشكل غير متزامن لمنع تجميد الواجهة) */
    @PluginMethod
    public void updateWidget(PluginCall call) {
        final Context c = getContext().getApplicationContext();
        try {
            JSONObject o = new JSONObject(call.getData().toString());
            if (!o.has("at")) o.put("at", System.currentTimeMillis());
            o.put("parser_v", SarrafData.PARSER_VERSION);
            SarrafData.prefs(c).edit().putString("widget", o.toString()).apply();
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        call.resolve();
        WIDGET_EXEC.execute(() -> {
            try { RatesWidget.updateAll(c); } catch (Exception ignored) { }
        });
    }

    /** {enabled, times:["09:00","14:00"] بتوقيت دمشق, title, body} → يجدول المنبّه الدقيق لأقرب موعد */
    @PluginMethod
    public void setMorning(PluginCall call) {
        Context c = getContext();
        try {
            JSONObject prev = SarrafData.appJson(c, "morning");
            JSONObject o = prev == null ? new JSONObject() : prev;
            if (call.hasOption("enabled")) o.put("enabled", call.getBoolean("enabled", false));
            if (call.hasOption("time")) o.put("time", call.getString("time", "09:00"));
            if (call.hasOption("times")) o.put("times", new org.json.JSONArray(call.getArray("times").toString()));
            if (call.hasOption("title")) o.put("title", call.getString("title"));
            if (call.hasOption("body")) { o.put("body", call.getString("body")); o.put("bodyAt", System.currentTimeMillis()); }
            SarrafData.prefs(c).edit().putString("morning", o.toString()).apply();
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        long at = MorningAlarm.schedule(c);
        JSObject r = new JSObject();
        r.put("nextAt", at);
        r.put("exact", MorningAlarm.canExact(c));
        call.resolve(r);
    }

    /** إشعار تجريبي فوري بنفس مسار الإشعار الصباحي */
    @PluginMethod
    public void fireMorningNow(PluginCall call) {
        MorningAlarm.post(getContext());
        call.resolve();
    }

    /** هل النظام ممكن يأخّر أو يمنع الإشعار؟ */
    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
        }
        boolean restricted = false;
        if (Build.VERSION.SDK_INT >= 28) {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            restricted = am != null && am.isBackgroundRestricted();
        }
        r.put("ignoringBattery", ignoring);
        r.put("backgroundRestricted", restricted);
        r.put("exact", MorningAlarm.canExact(c));
        r.put("notificationsEnabled", NotificationManagerCompat.from(c).areNotificationsEnabled());
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("manufacturer", Build.MANUFACTURER);
        long next = MorningAlarm.nextTrigger(c, System.currentTimeMillis());
        r.put("nextAt", next);
        call.resolve(r);
    }

    // ================= تحديث الـ APK من جوا التطبيق =================

    private static byte[] certDigest(PackageInfo info) throws Exception {
        if (info == null) return null;
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            sigs = info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        } else {
            sigs = info.signatures;
        }
        if (sigs == null || sigs.length == 0) return null;
        return MessageDigest.getInstance("SHA-256").digest(sigs[0].toByteArray());
    }

    /** {url, sha256?} → تنزيل الـ APK مع التحقق من النطاق وSHA-256 وشهادة التوقيع */
    @PluginMethod
    public void downloadApk(PluginCall call) {
        final String urlStr = call.getString("url");
        final String expectedSha = call.getString("sha256");
        if (urlStr == null || !urlStr.startsWith("https://")) { call.reject("رابط غير صالح"); return; }
        try {
            String host = new URL(urlStr).getHost().toLowerCase(java.util.Locale.US);
            if (!ALLOWED_APK_HOSTS.contains(host)) { call.reject("مصدر التحديث غير موثوق"); return; }
        } catch (Exception e) { call.reject("رابط غير صالح"); return; }
        if (!APK_DOWNLOADING.compareAndSet(false, true)) { call.reject("التنزيل جارٍ بالفعل"); return; }

        new Thread(() -> {
            Context c = getContext();
            File out = apkFile(c);
            File dir = out.getParentFile();
            File tmp = new File(dir, "sarraf.apk.tmp");
            HttpURLConnection con = null;
            try {
                if (dir != null) dir.mkdirs();
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                con = (HttpURLConnection) new URL(urlStr).openConnection();
                con.setInstanceFollowRedirects(true);
                con.setConnectTimeout(15000);
                con.setReadTimeout(30000);
                int code = con.getResponseCode();
                if (code != 200) throw new Exception("HTTP " + code);
                long total = con.getContentLengthLong(), got = 0;
                int lastPct = -1;
                try (InputStream in = new BufferedInputStream(con.getInputStream());
                     OutputStream os = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[32768];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        md.update(buf, 0, n);
                        got += n;
                        if (got > 80L * 1024 * 1024) throw new Exception("الملف أكبر من المتوقع");
                        int pct = total > 0 ? (int) (got * 100 / total) : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject p = new JSObject();
                            p.put("pct", pct);
                            p.put("bytes", got);
                            notifyListeners("apkProgress", p);
                        }
                    }
                }
                if (expectedSha != null && !expectedSha.trim().isEmpty()) {
                    String gotSha = Ota.hex(md.digest());
                    if (!gotSha.equalsIgnoreCase(expectedSha.trim())) throw new Exception("بصمة الملف غير مطابقة");
                }
                // تحقق: نفس الحزمة، رقم نسخة أحدث، ونفس شهادة التوقيع
                PackageManager pm = c.getPackageManager();
                int sigFlag = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
                PackageInfo info = pm.getPackageArchiveInfo(tmp.getAbsolutePath(), sigFlag);
                if (info == null || !c.getPackageName().equals(info.packageName)) throw new Exception("الملف مو تطبيق صرّاف");
                PackageInfo curInfo = pm.getPackageInfo(c.getPackageName(), sigFlag);
                long curVc = PackageInfoCompat.getLongVersionCode(curInfo);
                long newVc = PackageInfoCompat.getLongVersionCode(info);
                if (newVc <= curVc) throw new Exception("النسخة المنزّلة مو أحدث من الموجودة");
                byte[] curCert = certDigest(curInfo), newCert = certDigest(info);
                if (curCert != null && newCert != null && !Arrays.equals(curCert, newCert)) {
                    throw new Exception("توقيع الملف غير مطابق لتطبيق صرّاف");
                }
                if (out.exists()) out.delete();
                if (!tmp.renameTo(out)) throw new Exception("تعذّر حفظ ملف التحديث");
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("versionCode", newVc);
                call.resolve(r);
            } catch (Exception e) {
                tmp.delete();
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                if (con != null) con.disconnect();
                APK_DOWNLOADING.set(false);
            }
        }).start();
    }

    /** فتح شاشة التثبيت للملف المنزّل */
    @PluginMethod
    public void installApk(PluginCall call) {
        Context c = getContext();
        File f = apkFile(c);
        JSObject r = new JSObject();
        if (!f.exists()) { call.reject("ما في ملف منزّل"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !c.getPackageManager().canRequestPackageInstalls()) {
            r.put("needPermission", true);
            call.resolve(r);
            return;
        }
        try {
            Uri uri = androidx.core.content.FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            r.put("needPermission", false);
            call.resolve(r);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26) {
            start(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())), call);
        } else start(new Intent(Settings.ACTION_SECURITY_SETTINGS), call);
    }

    // ================= التحديث الهوائي (OTA) =================

    @PluginMethod
    public void otaDownload(PluginCall call) {
        final String url = call.getString("url");
        final String sha = call.getString("sha256");
        final int build = call.getInt("build", 0);
        if (url == null || !url.startsWith("https://") || sha == null || build <= 0) { call.reject("بيانات ناقصة أو غير آمنة"); return; }
        if (Ota.isBad(getContext(), build)) { call.reject("الحزمة معلّمة كمعطوبة"); return; }
        new Thread(() -> {
            try {
                String path = Ota.download(getContext(), url, sha, build);
                JSObject r = new JSObject();
                r.put("path", path);
                call.resolve(r);
            } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        }).start();
    }

    @PluginMethod
    public void otaApply(PluginCall call) {
        String path = call.getString("path");
        int build = call.getInt("build", 0);
        boolean now = call.getBoolean("now", false);
        try {
            Ota.apply(getContext(), path, build, now);
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        call.resolve();
        if (now) getBridge().setServerBasePath(path);
    }

    @PluginMethod
    public void otaReady(PluginCall call) {
        JSObject r = new JSObject();
        r.put("build", Ota.ready(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void otaInfo(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("build", SarrafData.prefs(c).getInt("otaCurrent", 0));
        String act = Ota.cap(c).getString(Ota.CAP_PATH, null);
        r.put("active", act != null && !act.isEmpty());
        r.put("bad", Ota.badList(c).toString());
        try {
            r.put("versionCode", PackageInfoCompat.getLongVersionCode(c.getPackageManager().getPackageInfo(c.getPackageName(), 0)));
        } catch (Exception e) { r.put("versionCode", 0); }
        call.resolve(r);
    }

    @PluginMethod
    public void otaReset(PluginCall call) {
        Ota.reset(getContext());
        call.resolve();
        getBridge().setServerAssetPath("public");
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        start(i, call);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), call);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            start(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName())), call);
        } else call.resolve();
    }

    private void start(Intent i, PluginCall call) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent f = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                f.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(f);
                call.resolve();
            } catch (Exception e2) { call.reject(e2.getMessage()); }
        }
    }
}
