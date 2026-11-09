package nl.crewharbor.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * CrewHarbor voor Android.
 *
 * Een lichte schil om de online app: de website ziet de brug "CrewdeckApp" en laat dan de
 * eenvoudige app-weergave zien (mobile.js: klokcode, taken, terugbellen, uren, account).
 * Omdat de app online laadt, hoeft de APK niet opnieuw gebouwd te worden als de website verandert.
 */
public class MainActivity extends Activity {

    /** Eerst het eigen domein; zolang dat nog niet live staat de GitHub-versie. */
    private static final String[] BASES = {
            "https://crewharbor.nl/app/",
            "https://bobber1846272.github.io/CrewHarbor/app/"
    };
    private static final String OFFLINE = "file:///android_asset/offline.html";
    private static final String CHANNEL = "meldingen";
    private static final int REQ_FILE = 1;
    private static final int REQ_NOTIF = 2;
    private static final int NAVY = 0xFF0D2340;
    private static final String VERSION = "5.0";

    private WebView web;
    private View topBar;
    private View bottomBar;
    private int baseIndex = 0;
    private int notifId = 100;
    private volatile boolean trusted = false;
    private ValueCallback<Uri[]> fileCallback;

    // ---------- opstarten ----------

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(NAVY);
        topBar = new View(this);
        topBar.setBackgroundColor(NAVY);
        web = new WebView(this);
        web.setBackgroundColor(NAVY);
        bottomBar = new View(this);
        bottomBar.setBackgroundColor(Color.WHITE);
        root.addView(topBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(bottomBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));
        setContentView(root);
        setupSystemBars(root);

        setupWebView();
        createChannel();
        askNotificationPermission();

        if (saved != null && web.restoreState(saved) != null) return;
        load(0);
    }

    /** Statusbalk donkerblauw (zoals de kop van de app), navigatiebalk wit (zoals de tabbalk). */
    private void setupSystemBars(View root) {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                setHeight(topBar, bars.top);
                setHeight(bottomBar, Math.max(bars.bottom, ime.bottom));
                v.setPadding(bars.left, 0, bars.right, 0);
                return WindowInsets.CONSUMED;
            });
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.setSystemBarsAppearance(WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS | WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            }
        } else if (Build.VERSION.SDK_INT >= 26) {
            View d = getWindow().getDecorView();
            d.setSystemUiVisibility(d.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    private static void setHeight(View v, int h) {
        ViewGroup.LayoutParams lp = v.getLayoutParams();
        if (lp.height != h) { lp.height = h; v.setLayoutParams(lp); }
    }

    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " CrewHarborApp/" + VERSION);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "CrewdeckApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            if (url != null && url.startsWith("https:")) openExternal(Uri.parse(url));
        });
    }

    private void load(int i) {
        baseIndex = i;
        web.loadUrl(BASES[i]);
    }

    /** Alleen onze eigen adressen mogen in de app openen en de brug gebruiken. */
    static boolean isTrusted(Uri u) {
        if (u == null || !"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null) return false;
        String h = u.getHost().toLowerCase();
        if (h.equals("crewharbor.nl") || h.equals("www.crewharbor.nl") || h.equals("crewharbor.pages.dev")) return true;
        String p = u.getPath() == null ? "" : u.getPath().toLowerCase();
        return h.equals("bobber1846272.github.io") && p.startsWith("/crewharbor/");
    }

    private void openExternal(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) { /* geen app die dit kan openen */ }
    }

    // ---------- navigatie ----------

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
            if (scheme.equals("crewharbor")) { load(0); return true; }
            if (isTrusted(u)) return false;
            if (!req.isForMainFrame() && scheme.equals("https")) return false;
            openExternal(u); // tel:, mailto: en andere websites
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            trusted = isTrusted(Uri.parse(url));
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) mainFailed();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse resp) {
            if (req.isForMainFrame() && resp.getStatusCode() >= 400) mainFailed();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            recreate();
            return true;
        }
    }

    /** Eigen domein niet bereikbaar: probeer het volgende adres, anders de offline-pagina. */
    private void mainFailed() {
        web.post(() -> {
            String cur = web.getUrl();
            if (cur != null && cur.startsWith("file:")) return;
            if (baseIndex < BASES.length - 1) load(baseIndex + 1);
            else { trusted = false; web.loadUrl(OFFLINE); }
        });
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                startActivityForResult(params.createIntent(), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        /** Links met target="_blank" (zoals "Naar de website") gaan naar de gewone browser. */
        @Override
        public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message msg) {
            WebView tmp = new WebView(MainActivity.this);
            tmp.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                    openExternal(req.getUrl());
                    v.destroy();
                    return true;
                }
            });
            ((WebView.WebViewTransport) msg.obj).setWebView(tmp);
            msg.sendToTarget();
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // eerst een open terugbelverzoek sluiten, dan terug in de geschiedenis, anders de app naar achteren
        web.evaluateJavascript(
                "(function(){var b=document.querySelector('[data-mact=\"cb-close\"]');if(b){b.click();return 1}return 0})()",
                v -> {
                    if ("1".equals(v)) return;
                    if (web.canGoBack() && !String.valueOf(web.getUrl()).startsWith("file:")) web.goBack();
                    else moveTaskToBack(true);
                });
    }

    // ---------- meldingen ----------

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(getString(R.string.channel_desc));
        ch.setLightColor(0xFF7FC4CF);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences p = getSharedPreferences("crewharbor", MODE_PRIVATE);
        if (p.getBoolean("askedNotif", false)) return;
        p.edit().putBoolean("askedNotif", true).apply();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
    }

    private void showNotification(String title, String body) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_crewharbor)
                .setColor(NAVY)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pi);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        getSystemService(NotificationManager.class).notify(notifId++, b.build());
    }

    // ---------- bestanden ----------

    private String save(String name, byte[] data, String mime) {
        String safe = (name == null || name.isEmpty() ? "crewharbor" : name).replaceAll("[\\\\/:*?\"<>|]", "_");
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/CrewHarbor");
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return null;
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) return null;
                    out.write(data);
                }
                return "Downloads/CrewHarbor";
            }
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) return null;
            if (!dir.exists() && !dir.mkdirs()) return null;
            try (FileOutputStream out = new FileOutputStream(new File(dir, safe))) {
                out.write(data);
            }
            return dir.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- brug voor de website (window.CrewdeckApp) ----------

    private class Bridge {
        @JavascriptInterface
        public void notify(String title, String body) {
            if (!trusted) return;
            runOnUiThread(() -> showNotification(title == null ? "CrewHarbor" : title, body == null ? "" : body));
        }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            if (!trusted) return;
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public String saveText(String name, String content, String mime) {
            if (!trusted || content == null) return null;
            return save(name, content.getBytes(StandardCharsets.UTF_8), mime);
        }

        @JavascriptInterface
        public String saveBase64(String name, String base64, String mime) {
            if (!trusted || base64 == null) return null;
            try {
                return save(name, Base64.decode(base64, Base64.DEFAULT), mime);
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
    }

    // ---------- levenscyclus ----------

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
