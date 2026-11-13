package com.liraconverter.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

/** ويدجت صغيرة 2×1: سعر الدولار بالليرة الجديدة مع سهم */
public class RatesWidgetSmall extends AppWidgetProvider {

    static void render(Context c, AppWidgetManager m, int[] ids) {
        SarrafData.Snapshot s = SarrafData.latest(c);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_small);
            v.setTextViewText(R.id.ws_value, s == null ? "—" : SarrafData.fmt(s.usd, 2));
            String arrow = s == null ? "" : s.usdDir > 0 ? "▲" : s.usdDir < 0 ? "▼" : "";
            v.setTextViewText(R.id.ws_arrow, arrow);
            v.setTextColor(R.id.ws_arrow, s != null && s.usdDir < 0 ? 0xFFF87171 : 0xFF22C55E);
            v.setTextViewText(R.id.ws_time, s == null ? "" : SarrafData.timeOf(s.at));
            PendingIntent pi = RatesWidget.openApp(c, 7002);
            if (pi != null) v.setOnClickPendingIntent(R.id.ws_root, pi);
            m.updateAppWidget(id, v);
        }
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { render(c, m, ids); }

    @Override
    public void onEnabled(Context c) { SarrafData.runner(c).edit().putString("widgetOn", "true").apply(); }

    @Override
    public void onDisabled(Context c) {
        int[] big = AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, RatesWidget.class));
        if (big == null || big.length == 0) SarrafData.runner(c).edit().putString("widgetOn", "false").apply();
    }
}
