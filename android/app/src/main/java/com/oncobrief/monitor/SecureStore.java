package com.oncobrief.monitor;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypts the device credential, configuration and unsent readings using Android Keystore. */
final class SecureStore {
    private static final String PREFS = "oncobrief_secure";
    private static final String ALIAS = "oncobrief_monitor_aes";
    private SecureStore() {}

    static synchronized void put(Context context, String key, String value) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getKey());
            byte[] encrypted = cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            ByteBuffer data = ByteBuffer.allocate(cipher.getIV().length + encrypted.length);
            data.put(cipher.getIV()).put(encrypted);
            prefs(context).edit().putString(key, Base64.encodeToString(data.array(), Base64.NO_WRAP)).apply();
        } catch (Exception e) {
            throw new IllegalStateException("Could not protect OncoBrief data on this phone", e);
        }
    }

    static synchronized String get(Context context, String key, String fallback) {
        String stored = prefs(context).getString(key, null);
        if (stored == null) return fallback;
        try {
            ByteBuffer data = ByteBuffer.wrap(Base64.decode(stored, Base64.NO_WRAP));
            byte[] iv = new byte[12];
            data.get(iv);
            byte[] encrypted = new byte[data.remaining()];
            data.get(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            prefs(context).edit().remove(key).apply();
            return fallback;
        }
    }

    static void remove(Context context, String key) {
        prefs(context).edit().remove(key).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey getKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
