package com.liraconverter.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SarrafNativePlugin.class);
        // التحديث الهوائي: إذا آخر حزمة واجهة ما اشتغلت، منرجع للي قبلها قبل ما Capacitor يحمّلها
        Ota.guard(this);
        super.onCreate(savedInstanceState);

        // أندرويد 15 (targetSdk 35) يفرض العرض من حافة لحافة: المحتوى بيصير تحت شريط الحالة وشريط التنقل.
        // نضيف هوامش بقدر الأشرطة (والكيبورد) حتى ما يتغطى شي، ونلوّن الخلفية بلون التطبيق.
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#0A1410"));
        androidx.core.view.WindowInsetsControllerCompat ctl = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (ctl != null) {
            ctl.setAppearanceLightStatusBars(false);
            ctl.setAppearanceLightNavigationBars(false);
        }
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });

        // بالخلفية (بدون إبطاء الفتح): جدولة المنبّه والمزامنة الدورية (كل 15 دقيقة) وتحديث الويدجت
        final android.content.Context appCtx = getApplicationContext();
        new Thread(() -> {
            MorningAlarm.schedule(appCtx);
            RatesSyncWorker.ensureScheduled(appCtx);
            RatesWidget.updateAll(appCtx);
        }).start();
    }
}
