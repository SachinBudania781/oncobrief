package com.oncobrief.monitor;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final int PERMISSION_REQUEST = 20;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, BluetoothDevice> found = new LinkedHashMap<>();
    private EditText serverField, patientField, tokenField;
    private TextView selectedLabel, statusLabel;
    private BluetoothDevice selected;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private Runnable pendingPermissionAction;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        buildScreen();
        serverField.setText(SecureStore.get(this, "server", "https://oncobrief-round2-patient.onrender.com"));
        patientField.setText(SecureStore.get(this, "patient", ""));
        tokenField.setText(SecureStore.get(this, "token", ""));
        selectedLabel.setText(SecureStore.get(this, "device_name", "No wearable selected"));
        String address = SecureStore.get(this, "device_address", "");
        if (!address.isEmpty() && hasBluetoothConnect()) {
            try { selected = adapter().getRemoteDevice(address); } catch (Exception ignored) {}
        }
        statusLabel.setText("Choose a Bluetooth wearable and start monitoring.");
    }

    private void buildScreen() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(28), dp(22), dp(28));
        scroll.addView(root);
        setContentView(scroll);

        TextView title = new TextView(this);
        title.setText("OncoBrief Monitor");
        title.setTextSize(26);
        title.setTypeface(null, 1);
        root.addView(title);

        TextView note = new TextView(this);
        note.setText("Background Bluetooth companion for compatible sensors. Keep the phone near the wearable. It cannot guarantee uninterrupted 24/7 readings and is not an emergency monitor.");
        note.setTextSize(15);
        note.setPadding(0, dp(10), 0, dp(18));
        root.addView(note);

        serverField = field(root, "OncoBrief patient app URL", "https://oncobrief-round2-patient.onrender.com");
        patientField = field(root, "Patient folder ID", "OB-0001");
        tokenField = field(root, "Android setup code from Wearables", "Paste the generated code");

        Button scan = new Button(this);
        scan.setText("Find nearby Bluetooth wearable");
        root.addView(scan);
        scan.setOnClickListener(v -> ensurePermissions(this::scanDevices));

        selectedLabel = new TextView(this);
        selectedLabel.setTextSize(14);
        selectedLabel.setPadding(0, dp(8), 0, dp(12));
        root.addView(selectedLabel);

        Button start = new Button(this);
        start.setText("Start background monitoring");
        root.addView(start);
        start.setOnClickListener(v -> ensurePermissions(this::startMonitoring));

        Button stop = new Button(this);
        stop.setText("Stop monitoring");
        root.addView(stop);
        stop.setOnClickListener(v -> {
            stopService(new Intent(this, MonitorService.class).setAction(MonitorService.ACTION_STOP));
            statusLabel.setText("Monitoring stopped.");
        });

        statusLabel = new TextView(this);
        statusLabel.setTextSize(14);
        statusLabel.setPadding(0, dp(18), 0, 0);
        root.addView(statusLabel);
    }

    private EditText field(LinearLayout parent, String label, String hint) {
        TextView caption = new TextView(this);
        caption.setText(label);
        caption.setTextSize(14);
        caption.setPadding(0, dp(8), 0, dp(4));
        parent.addView(caption);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint(hint);
        input.setPadding(dp(12), dp(8), dp(12), dp(8));
        parent.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return input;
    }

    private void ensurePermissions(Runnable next) {
        List<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.BLUETOOTH_SCAN);
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.BLUETOOTH_CONNECT);
        } else if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (missing.isEmpty()) { next.run(); return; }
        pendingPermissionAction = next;
        requestPermissions(missing.toArray(new String[0]), PERMISSION_REQUEST);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != PERMISSION_REQUEST) return;
        for (int result : results) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                statusLabel.setText("Bluetooth and notification permissions are needed for background monitoring.");
                pendingPermissionAction = null;
                return;
            }
        }
        Runnable action = pendingPermissionAction;
        pendingPermissionAction = null;
        if (action != null) action.run();
    }

    private void scanDevices() {
        if (!hasBluetoothConnect()) return;
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
            statusLabel.setText("Turn on Bluetooth, then scan again.");
            return;
        }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            statusLabel.setText("Bluetooth scanning is unavailable on this phone.");
            return;
        }
        found.clear();
        statusLabel.setText("Scanning nearby devices for 10 seconds…");
        scanCallback = new ScanCallback() {
            @Override public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                if (device != null) runOnUiThread(() -> found.put(device.getAddress(), device));
            }
            @Override public void onScanFailed(int errorCode) {
                runOnUiThread(() -> statusLabel.setText("Bluetooth scan failed (" + errorCode + ")."));
            }
        };
        try {
            scanner.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
            handler.postDelayed(this::showFoundDevices, 10000);
        } catch (SecurityException e) {
            statusLabel.setText("Bluetooth scan permission was denied.");
        }
    }

    private void showFoundDevices() {
        stopScan();
        if (found.isEmpty()) {
            statusLabel.setText("No nearby devices found. Keep the wearable awake and scan again.");
            return;
        }
        List<BluetoothDevice> devices = new ArrayList<>(found.values());
        String[] names = new String[devices.size()];
        for (int i = 0; i < devices.size(); i++) {
            BluetoothDevice device = devices.get(i);
            String name;
            try { name = device.getName(); } catch (SecurityException e) { name = null; }
            names[i] = (name == null || name.isEmpty() ? "Unnamed wearable" : name) + " · " + device.getAddress();
        }
        new AlertDialog.Builder(this).setTitle("Select your wearable").setItems(names, (dialog, which) -> {
            selected = devices.get(which);
            String name;
            try { name = selected.getName(); } catch (SecurityException e) { name = null; }
            if (name == null || name.isEmpty()) name = "Bluetooth wearable";
            selectedLabel.setText(name + " · " + selected.getAddress());
            SecureStore.put(this, "device_address", selected.getAddress());
            SecureStore.put(this, "device_name", name);
        }).setNegativeButton("Cancel", null).show();
        statusLabel.setText("Only devices exposing supported standard health services can stream.");
    }

    private void stopScan() {
        if (scanner != null && scanCallback != null && hasBluetoothConnect()) {
            try { scanner.stopScan(scanCallback); } catch (SecurityException ignored) {}
        }
        scanner = null;
        scanCallback = null;
    }

    private void startMonitoring() {
        String base = serverField.getText().toString().trim().replaceAll("/+$", "");
        String patient = patientField.getText().toString().trim().toUpperCase();
        String secret = tokenField.getText().toString().trim();
        if (!base.startsWith("https://") || patient.isEmpty() || secret.length() < 24 || selected == null) {
            statusLabel.setText("Enter the HTTPS patient app URL, patient folder ID and setup code, then choose a wearable.");
            return;
        }
        SecureStore.put(this, "server", base);
        SecureStore.put(this, "patient", patient);
        SecureStore.put(this, "token", secret);
        SecureStore.put(this, "device_address", selected.getAddress());
        String name;
        try { name = selected.getName(); } catch (SecurityException e) { name = null; }
        SecureStore.put(this, "device_name", name == null ? "Bluetooth wearable" : name);
        Intent service = new Intent(this, MonitorService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service);
        else startService(service);
        statusLabel.setText("Monitoring started. Leave the visible Android notification enabled.");
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private boolean hasBluetoothConnect() {
        return Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    @Override protected void onDestroy() {
        stopScan();
        super.onDestroy();
    }
}
