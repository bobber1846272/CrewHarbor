package nl.crewharbor.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Eigen tweestapsverificatie: de CrewHarbor-app als authenticator.
 *
 * De TOTP-sleutel (zelfde soort als in Google/Microsoft Authenticator: SHA-1, 6 cijfers, 30 s) wordt
 * versleuteld met een AES-sleutel uit de Android Keystore. Die sleutel kan de telefoon niet uit, ook niet
 * via een back-up (allowBackup staat uit). Per Supabase-factor één item: { label, data }.
 */
final class Totp {
    private static final String ALIAS = "crewharbor_totp";
    private static final String PREFS = "crewharbor_totp";
    private static final int PERIOD = 30;

    private final SharedPreferences prefs;

    Totp(Context ctx) {
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------- opslaan ----------

    boolean save(String factorId, String secretBase32, String label) {
        if (factorId == null || factorId.isEmpty() || base32(secretBase32) == null) return false;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] ct = c.doFinal(secretBase32.replaceAll("\\s", "").toUpperCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
            byte[] iv = c.getIV();
            byte[] all = ByteBuffer.allocate(1 + iv.length + ct.length).put((byte) iv.length).put(iv).put(ct).array();
            JSONObject o = new JSONObject();
            o.put("label", label == null ? "" : label);
            o.put("data", Base64.encodeToString(all, Base64.NO_WRAP));
            o.put("added", System.currentTimeMillis());
            prefs.edit().putString(factorId, o.toString()).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    void remove(String factorId) {
        if (factorId != null) prefs.edit().remove(factorId).apply();
    }

    /** [{ id, label }] — zonder geheimen. */
    String list() {
        JSONArray a = new JSONArray();
        try {
            for (String id : prefs.getAll().keySet()) {
                JSONObject o = new JSONObject(prefs.getString(id, "{}"));
                a.put(new JSONObject().put("id", id).put("label", o.optString("label")).put("added", o.optLong("added")));
            }
        } catch (Exception e) { /* lege lijst */ }
        return a.toString();
    }

    /** { code, left } of null als deze factor hier niet staat. */
    String code(String factorId) {
        String secret = secret(factorId);
        if (secret == null) return null;
        long now = System.currentTimeMillis() / 1000L;
        String code = generate(base32(secret), now / PERIOD);
        try {
            return new JSONObject().put("code", code).put("left", PERIOD - (int) (now % PERIOD)).toString();
        } catch (Exception e) {
            return null;
        }
    }

    // ---------- intern ----------

    private String secret(String factorId) {
        String raw = factorId == null ? null : prefs.getString(factorId, null);
        if (raw == null) return null;
        try {
            byte[] all = Base64.decode(new JSONObject(raw).getString("data"), Base64.NO_WRAP);
            int ivLen = all[0];
            byte[] iv = new byte[ivLen];
            System.arraycopy(all, 1, iv, 0, ivLen);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            byte[] pt = c.doFinal(all, 1 + ivLen, all.length - 1 - ivLen);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    /** RFC 6238 / RFC 4226: HMAC-SHA1, 6 cijfers. */
    static String generate(byte[] key, long counter) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            byte[] h = mac.doFinal(ByteBuffer.allocate(8).putLong(counter).array());
            int o = h[h.length - 1] & 0x0f;
            int bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
            return String.format(Locale.ROOT, "%06d", bin % 1_000_000);
        } catch (Exception e) {
            return null;
        }
    }

    /** RFC 4648 base32 (hoofdletters, zonder =). */
    static byte[] base32(String s) {
        if (s == null) return null;
        s = s.replaceAll("[\\s=]", "").toUpperCase(Locale.ROOT);
        if (s.isEmpty()) return null;
        String abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        ByteBuffer out = ByteBuffer.allocate(s.length() * 5 / 8);
        int buf = 0, bits = 0;
        for (int i = 0; i < s.length(); i++) {
            int v = abc.indexOf(s.charAt(i));
            if (v < 0) return null;
            buf = (buf << 5) | v;
            bits += 5;
            if (bits >= 8) { out.put((byte) (buf >> (bits - 8))); bits -= 8; }
        }
        byte[] r = new byte[out.position()];
        out.flip();
        out.get(r);
        return r;
    }
}
