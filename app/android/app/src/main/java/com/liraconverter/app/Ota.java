package com.liraconverter.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * التحديث الهوائي (OTA) لواجهة التطبيق بدون APK جديد.
 * - تنزيل حزمة zip للواجهة + التحقق من SHA-256 + فك الضغط بمجلد خاص.
 * - Capacitor نفسه بيحمّل الواجهة من المسار المحفوظ بـ CapWebViewSettings/serverBasePath،
 *   وبيرجع للنسخة المدمجة تلقائياً لما ينزل APK جديد.
 * - حماية من نسخة معطوبة: إذا الواجهة الجديدة ما قالت "أنا شغالة" (ready) خلال تشغيل واحد،
 *   بالتشغيل اللي بعده منرجع للنسخة القديمة ومنسجّل الحزمة كمعطوبة.
 */
public final class Ota {
    static final String CAP_PREFS = "CapWebViewSettings";   // com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME
    static final String CAP_PATH = "serverBasePath";        // com.getcapacitor.plugin.WebView.CAP_SERVER_PATH
    static final int MAX_BYTES = 15 * 1024 * 1024;

    private Ota() {}

    static SharedPreferences cap(Context c) { return c.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE); }

    static File root(Context c) { return new File(c.getFilesDir(), "ota"); }

    /** يُستدعى قبل super.onCreate بـ MainActivity: يقرر نرجع للنسخة القديمة أو لا */
    public static void guard(Context c) {
        try {
            JSONObject p = SarrafData.appJson(c, "otaPending");
            if (p == null) return;
            int tries = p.optInt("tries", 0);
            if (tries >= 1) {
                // الحزمة تشغّلت مرة وما أكّدت إنها شغالة → رجوع
                rollback(c, p.optInt("build"), p.optString("prevPath", null));
            } else {
                p.put("tries", tries + 1);
                SarrafData.prefs(c).edit().putString("otaPending", p.toString()).apply();
            }
        } catch (Exception ignored) { }
    }

    static void rollback(Context c, int badBuild, String prevPath) {
        SharedPreferences.Editor e = cap(c).edit();
        if (prevPath != null && !prevPath.isEmpty() && new File(prevPath).exists()) e.putString(CAP_PATH, prevPath);
        else e.remove(CAP_PATH);
        e.apply();
        try {
            JSONArray bad = badList(c);
            bad.put(badBuild);
            SarrafData.prefs(c).edit().putString("otaBad", bad.toString()).remove("otaPending").apply();
        } catch (Exception ignored) { }
    }

    static JSONArray badList(Context c) {
        try { return new JSONArray(SarrafData.prefs(c).getString("otaBad", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static boolean isBad(Context c, int build) {
        JSONArray a = badList(c);
        for (int i = 0; i < a.length(); i++) if (a.optInt(i) == build) return true;
        return false;
    }

    /** تنزيل + تحقق + فك ضغط. يرجع مسار المجلد الجاهز. (يُستدعى بخيط خلفي) */
    public static String download(Context c, String url, String sha256, int build) throws Exception {
        File dir = new File(root(c), String.valueOf(build));
        File zip = new File(c.getCacheDir(), "ota-" + build + ".zip");
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setInstanceFollowRedirects(true);
        con.setConnectTimeout(15000);
        con.setReadTimeout(30000);
        if (con.getResponseCode() != 200) throw new Exception("HTTP " + con.getResponseCode());
        long total = 0;
        try (InputStream in = new BufferedInputStream(con.getInputStream()); OutputStream out = new FileOutputStream(zip)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new Exception("الحزمة أكبر من المسموح");
                md.update(buf, 0, n);
                out.write(buf, 0, n);
            }
        } finally { con.disconnect(); }
        String got = hex(md.digest());
        if (sha256 == null || !got.equalsIgnoreCase(sha256.trim())) {
            zip.delete();
            throw new Exception("SHA-256 مو مطابق");
        }
        deleteRec(dir);
        if (!dir.mkdirs() && !dir.exists()) throw new Exception("ما قدرنا ننشئ المجلد");
        String base = dir.getCanonicalPath() + File.separator;
        try (ZipInputStream zin = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry en;
            byte[] buf = new byte[16384];
            while ((en = zin.getNextEntry()) != null) {
                String name = en.getName().replace('\\', '/');
                while (name.startsWith("./")) name = name.substring(2);
                if (name.isEmpty()) continue; // مدخل المجلد الجذر نفسه "./"
                File f = new File(dir, name);
                if (!f.getCanonicalPath().startsWith(base)) throw new Exception("مسار غير آمن بالحزمة"); // zip-slip
                if (en.isDirectory()) { f.mkdirs(); continue; }
                File parent = f.getParentFile();
                if (parent != null) parent.mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
        } finally { zip.delete(); }
        if (!new File(dir, "index.html").exists()) { deleteRec(dir); throw new Exception("الحزمة ما فيها index.html"); }
        return dir.getAbsolutePath();
    }

    /** تفعيل الحزمة: بالتشغيل الجاي (now=false) أو هلأ (now=true، والجلسة الحالية بتنحسب تجربة) */
    public static void apply(Context c, String path, int build, boolean now) throws Exception {
        String prev = cap(c).getString(CAP_PATH, null);
        JSONObject p = new JSONObject();
        p.put("build", build);
        p.put("path", path);
        p.put("prevPath", prev == null ? "" : prev);
        p.put("tries", now ? 1 : 0);
        SarrafData.prefs(c).edit().putString("otaPending", p.toString()).apply();
        cap(c).edit().putString(CAP_PATH, path).apply();
    }

    /** الواجهة الجديدة اشتغلت: نثبّتها ونحذف الحزم القديمة */
    public static int ready(Context c) {
        JSONObject p = SarrafData.appJson(c, "otaPending");
        int build = SarrafData.prefs(c).getInt("otaCurrent", 0);
        if (p != null) {
            build = p.optInt("build");
            SarrafData.prefs(c).edit().remove("otaPending").putInt("otaCurrent", build).apply();
        }
        String cur = cap(c).getString(CAP_PATH, null);
        File[] old = root(c).listFiles();
        if (old != null) for (File f : old) {
            // نقارن مسارات مطلقة (مو canonical: ‎/data/user/0 رابط رمزي لـ ‎/data/data)
            if (cur == null || !new File(cur).getAbsolutePath().startsWith(f.getAbsolutePath())) deleteRec(f);
        }
        return build;
    }

    /** رجوع يدوي للواجهة المدمجة بالـ APK */
    public static void reset(Context c) {
        cap(c).edit().remove(CAP_PATH).apply();
        SarrafData.prefs(c).edit().remove("otaPending").remove("otaCurrent").apply();
        deleteRec(root(c));
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    static void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        File[] k = f.listFiles();
        if (k != null) for (File x : k) deleteRec(x);
        f.delete();
    }
}
