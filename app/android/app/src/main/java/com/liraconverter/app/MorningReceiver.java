package com.liraconverter.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** يُطلق بالوقت المحدد: يعرض الإشعار ثم يجدول موعد بكرا. ويعيد الجدولة بعد إعادة تشغيل الجهاز أو تحديث التطبيق. */
public class MorningReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if ("com.liraconverter.app.MORNING".equals(a)) {
            MorningAlarm.post(context);
        }
        // MORNING أو BOOT_COMPLETED أو MY_PACKAGE_REPLACED أو تغيّر صلاحية المنبّهات الدقيقة
        MorningAlarm.schedule(context);
        RatesWidget.updateAll(context);
    }
}
