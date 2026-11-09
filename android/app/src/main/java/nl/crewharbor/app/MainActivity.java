package nl.crewharbor.app;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
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
import android.graphics.Typeface;
import android.hardware.biometrics.BiometricPrompt;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.Message;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
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
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

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
    private static final String VERSION = "5.2";
    private static final int REQ_UNLOCK = 3;
    /** zo lang mag de app op de achtergrond staan voordat hij weer op slot gaat */
    private static final long LOCK_AFTER_MS = 30_000;

    private WebView web;
    private View topBar;
    private View bottomBar;
    private int baseIndex = 0;
    private int notifId = 100;
    private volatile boolean trusted = false;
    private ValueCallback<Uri[]> fileCallback;
    private volatile boolean offlinePage = false;
    private Totp totp;
    private SharedPreferences prefs;
    private View lockView;
    private boolean locked = false;
    private boolean pendingEnable = false;
    private boolean authBusy = false;
    private boolean autoPrompt = false;
    private long backgroundAt = 0;
    private ConnectivityManager.NetworkCallback netCallback;

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
        prefs = getSharedPreferences("crewharbor", MODE_PRIVATE);
        totp = new Totp(this);
        lockView = buildLockView();
        FrameLayout frame = new FrameLayout(this);
        frame.addView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        frame.addView(lockView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(frame);
        setupSystemBars(root);

        setupWebView();
        createChannel();
        askNotificationPermission();
        watchNetwork();

        // vergrendeld starten als het slot aan staat
        setLocked(lockOn());

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
            offlinePage = OFFLINE.equals(url);
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
        if (req == REQ_UNLOCK) { authBusy = false; authDone(result == RESULT_OK); return; }
        if (req == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (locked) { moveTaskToBack(true); return; }
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
        public String appVersion() { return VERSION; }

        // --- 6. laatste stand bewaren voor als er geen internet is ---
        @JavascriptInterface
        public void saveSnapshot(String json) {
            if (!trusted) return;
            if (json == null || json.isEmpty()) prefs.edit().remove("snapshot").apply();
            else if (json.length() < 200_000) prefs.edit().putString("snapshot", json).apply();
        }

        @JavascriptInterface
        public String getSnapshot() {
            if (!trusted && !offlinePage) return null;
            return prefs.getString("snapshot", null);
        }

        @JavascriptInterface
        public void goOffline() {
            if (!trusted) return;
            runOnUiThread(() -> { trusted = false; web.loadUrl(OFFLINE); });
        }

        // --- 7. slot met vingerafdruk, gezicht of schermvergrendeling ---
        @JavascriptInterface
        public boolean lockAvailable() { return deviceSecure(); }

        @JavascriptInterface
        public boolean lockEnabled() { return lockOn(); }

        @JavascriptInterface
        public void setLock(boolean on) {
            if (!trusted) return;
            runOnUiThread(() -> {
                if (!on) { prefs.edit().putBoolean("lock", false).apply(); lockResult(false); return; }
                if (!deviceSecure()) { lockResult(false); return; }
                pendingEnable = true;
                authenticate();
            });
        }

        // --- 8. eigen tweestapsverificatie ---
        @JavascriptInterface
        public boolean totpSave(String factorId, String secret, String label) {
            return trusted && totp.save(factorId, secret, label);
        }

        @JavascriptInterface
        public String totpCode(String factorId) {
            if (!trusted || locked) return null;
            return totp.code(factorId);
        }

        @JavascriptInterface
        public String totpList() { return trusted ? totp.list() : "[]"; }

        @JavascriptInterface
        public void totpRemove(String factorId) { if (trusted) totp.remove(factorId); }

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

    // ---------- slot ----------

    private boolean lockOn() { return prefs.getBoolean("lock", false) && deviceSecure(); }

    private boolean deviceSecure() {
        KeyguardManager km = getSystemService(KeyguardManager.class);
        return km != null && km.isDeviceSecure();
    }

    private View buildLockView() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        v.setGravity(Gravity.CENTER);
        v.setBackgroundColor(NAVY);
        v.setClickable(true); // niets erachter aanklikbaar
        int pad = dp(32);
        v.setPadding(pad, pad, pad, pad);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher_foreground);
        v.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(96)));
        TextView t = new TextView(this);
        t.setText("CrewHarbor is vergrendeld");
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER);
        v.addView(t);
        TextView sub = new TextView(this);
        sub.setText("Ontgrendel met je vingerafdruk, gezicht of schermvergrendeling.");
        sub.setTextColor(0xFFB9C6D3);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.topMargin = dp(8);
        v.addView(sub, sp);
        Button b = new Button(this);
        b.setText("Ontgrendelen");
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTextColor(NAVY);
        b.setBackgroundColor(0xFFEDE8DC);
        b.setOnClickListener(x -> authenticate());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(dp(220), dp(52));
        bp.topMargin = dp(28);
        v.addView(b, bp);
        v.setVisibility(View.GONE);
        return v;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void setLocked(boolean on) {
        locked = on;
        autoPrompt = on;
        lockView.setVisibility(on ? View.VISIBLE : View.GONE);
        if (on) lockView.bringToFront();
        // geen inkijk via het overzicht van recente apps
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!lockOn());
    }

    /** Vingerafdruk/gezicht, met de pincode of het patroon van de telefoon als terugval. */
    private void authenticate() {
        if (authBusy) return;
        if (!deviceSecure()) { authDone(!pendingEnable); return; }
        authBusy = true;
        if (Build.VERSION.SDK_INT >= 28) {
            BiometricPrompt.Builder b = new BiometricPrompt.Builder(this)
                    .setTitle(pendingEnable ? "Slot aanzetten" : "CrewHarbor ontgrendelen")
                    .setSubtitle(pendingEnable ? "Bevestig dat jij het bent" : "Gebruik je vingerafdruk, gezicht of schermvergrendeling");
            if (Build.VERSION.SDK_INT >= 30) {
                b.setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } else if (Build.VERSION.SDK_INT == 29) {
                b.setDeviceCredentialAllowed(true);
            } else {
                b.setNegativeButton("Annuleren", getMainExecutor(), (d, w) -> { authBusy = false; authDone(false); });
            }
            try {
                b.build().authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) { authBusy = false; authDone(true); }
                    @Override public void onAuthenticationError(int code, CharSequence msg) { authBusy = false; authDone(false); }
                });
            } catch (Exception e) {
                authBusy = false;
                authViaKeyguard();
            }
        } else {
            authViaKeyguard();
        }
    }

    @SuppressWarnings("deprecation")
    private void authViaKeyguard() {
        KeyguardManager km = getSystemService(KeyguardManager.class);
        Intent i = km == null ? null : km.createConfirmDeviceCredentialIntent(pendingEnable ? "Slot aanzetten" : "CrewHarbor ontgrendelen", "Bevestig dat jij het bent");
        if (i == null) { authDone(!pendingEnable); return; }
        authBusy = true;
        startActivityForResult(i, REQ_UNLOCK);
    }

    private void authDone(boolean ok) {
        if (pendingEnable) {
            pendingEnable = false;
            if (ok) prefs.edit().putBoolean("lock", true).apply();
            lockResult(ok);
            if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!lockOn());
            return;
        }
        if (ok) setLocked(false);
    }

    private void lockResult(boolean on) {
        web.evaluateJavascript("window.CHApp&&CHApp.lock&&CHApp.lock(" + (on && lockOn()) + ")", null);
    }

    // ---------- netwerk terug: offline-pagina vervangen door de app ----------

    private void watchNetwork() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) {
                web.postDelayed(() -> { if (offlinePage) load(0); }, 1500);
            }
        };
        try { cm.registerDefaultNetworkCallback(netCallback); } catch (Exception e) { netCallback = null; }
    }

    // ---------- levenscyclus ----------

    @Override
    protected void onStart() {
        super.onStart();
        if (backgroundAt > 0 && lockOn() && System.currentTimeMillis() - backgroundAt > LOCK_AFTER_MS) setLocked(true);
        backgroundAt = 0;
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (!authBusy && fileCallback == null) backgroundAt = System.currentTimeMillis();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && locked && autoPrompt && !authBusy) { autoPrompt = false; authenticate(); }
    }

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
        if (netCallback != null) {
            try { getSystemService(ConnectivityManager.class).unregisterNetworkCallback(netCallback); } catch (Exception e) { /* */ }
        }
        if (web != null) {
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
