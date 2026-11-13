package com.liraconverter.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * الإشعار الصباحي: منبّه دقيق (exact) يومي بالوقت المحدد بتوقيت دمشق.
 * المحتوى يُقرأ لحظة الإطلاق: أحدث نص جهّزه الـ Background Runner (قبل الموعد)، وإلا آخر نص من التطبيق.
 * ملاحظة: إضافة LocalNotifications تثبّت نص الإشعار لحظة الجدولة ولا تسمح بتحديثه من الخلفية،
 * لذلك نستعمل نفس آلية Android (AlarmManager.setExactAndAllowWhileIdle) مباشرة.
 */
public final class MorningAlarm {
    static final String CHANNEL = "morning";
    static final int NOTIFY_ID = 900;
    static final int REQ = 9001;

    private MorningAlarm() {}

    static PendingIntent pending(Context c) {
        Intent i = new Intent(c, MorningReceiver.class).setAction("com.liraconverter.app.MORNING");
        return PendingIntent.getBroadcast(c, REQ, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /** أقرب موعد جاي (ميلي ثانية) بين كل الأوقات (1 لـ 3 باليوم)، أو -1 إذا الإشعار متوقف */
    public static long nextTrigger(Context c, long now) {
        JSONObject m = SarrafData.appJson(c, "morning");
        if (m == null || !m.optBoolean("enabled")) return -1;
        java.util.List<String> times = new java.util.ArrayList<>();
        org.json.JSONArray arr = m.optJSONArray("times");
        if (arr != null) for (int i = 0; i < arr.length(); i++) times.add(arr.optString(i));
        if (times.isEmpty()) times.add(m.optString("time", "09:00"));
        long best = -1;
        for (String t : times) {
            try {
                String[] hm = t.split(":");
                int h = Integer.parseInt(hm[0].trim()), min = hm.length > 1 ? Integer.parseInt(hm[1].trim()) : 0;
                Calendar cal = Calendar.getInstance(SarrafData.DAMASCUS);
                cal.setTimeInMillis(now);
                cal.set(Calendar.HOUR_OF_DAY, h);
                cal.set(Calendar.MINUTE, min);
                cal.set(Calendar.SECOND, 0);
                cal.set(Calendar.MILLISECOND, 0);
                if (cal.getTimeInMillis() <= now + 1000) cal.add(Calendar.DAY_OF_MONTH, 1);
                long at = cal.getTimeInMillis();
                if (best < 0 || at < best) best = at;
            } catch (Exception ignored) { }
        }
        return best;
    }

    /** يجدول المنبّه التالي (أو يلغيه). يرجع وقت الإطلاق. */
    public static long schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = pending(c);
        long at = nextTrigger(c, System.currentTimeMillis());
        if (am == null) return -1;
        am.cancel(pi);
        if (at < 0) return -1;
        if (canExact(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi); // بدون صلاحية exact: قد يتأخر دقائق
        return at;
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "أسعار الصباح", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("إشعار يومي بسعر الدولار والتركي والذهب");
                nm.createNotificationChannel(ch);
            }
        }
    }

    /** النص الأحدث: من الـ runner إذا جهّزه خلال آخر 3 ساعات وكان أحدث من نص التطبيق */
    static String[] content(Context c) {
        String title = "صرّاف – أسعار اليوم";
        String body = null;
        long bodyAt = 0;
        JSONObject app = SarrafData.appJson(c, "morning");
        if (app != null) {
            body = app.optString("body", null);
            bodyAt = app.optLong("bodyAt", 0);
            title = app.optString("title", title);
        }
        JSONObject r = SarrafData.runnerJson(c, "morningBody");
        if (r != null) {
            long at = r.optLong("at", 0);
            if (at > bodyAt && System.currentTimeMillis() - at < 3 * 3600_000L) {
                body = r.optString("body", body);
            }
        }
        if (body == null || body.isEmpty()) body = "افتح صرّاف لتشوف أسعار اليوم";
        return new String[] { title, body };
    }

    public static void post(Context c) {
        ensureChannel(c);
        String[] tb = content(c);
        String first = tb[1].split("\n")[0];
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent pi = open == null ? null
            : PendingIntent.getActivity(c, NOTIFY_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_sarraf)
            .setColor(0xFFD4AF37)
            .setContentTitle(tb[0])
            .setContentText(first)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(tb[1]))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (pi != null) b.setContentIntent(pi);
        try {
            NotificationManagerCompat.from(c).notify(NOTIFY_ID, b.build());
        } catch (SecurityException e) { /* صلاحية الإشعارات مسحوبة */ }
        SarrafData.prefs(c).edit().putLong("lastMorningPost", System.currentTimeMillis()).apply();
    }
}
