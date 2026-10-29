package com.oncobrief.monitor;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MonitorService extends Service {
    static final String ACTION_STOP = "com.oncobrief.monitor.STOP";
    private static final String CHANNEL = "wearable_monitor";
    private static final int NOTIFICATION_ID = 8401;
    private static final int MAX_QUEUE = 20000;
    private static final int BATCH_SIZE = 100;
    private static final UUID HEART_SERVICE = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
    private static final UUID HEART_MEASUREMENT = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
    private static final UUID OX_SERVICE = UUID.fromString("00001822-0000-1000-8000-00805f9b34fb");
    private static final UUID OX_CONTINUOUS = UUID.fromString("00002a5f-0000-1000-8000-00805f9b34fb");
    private static final UUID OX_SPOT = UUID.fromString("00002a5e-0000-1000-8000-00805f9b34fb");
    private static final UUID BP_SERVICE = UUID.fromString("00001810-0000-1000-8000-00805f9b34fb");
    private static final UUID BP_MEASUREMENT = UUID.fromString("00002a35-0000-1000-8000-00805f9b34fb");
    private static final UUID TEMP_SERVICE = UUID.fromString("00001809-0000-1000-8000-00805f9b34fb");
    private static final UUID TEMP_MEASUREMENT = UUID.fromString("00002a1c-0000-1000-8000-00805f9b34fb");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicBoolean flushing = new AtomicBoolean(false);
    private final Queue<BluetoothGattCharacteristic> pendingSubscriptions = new ArrayDeque<>();
    private final Queue<JSONObject> pendingReadings = new ArrayDeque<>();
    private boolean queueLoaded;
    private boolean queueDirty;
    private BluetoothGatt gatt;
    private String patientId, token, baseUrl, deviceAddress, deviceName;
    private boolean stopping;

    private final Runnable flushLoop = new Runnable() {
        @Override public void run() {
            flushBatch();
            handler.postDelayed(this, 15000);
        }
    };
    private final Runnable reconnectTask = this::connect;

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopMonitoring();
            return START_NOT_STICKY;
        }
        stopping = false;
        loadSettings();
        if (!hasConnectPermission() || deviceAddress == null || deviceAddress.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startAsForeground("Connecting to your wearable…");
        connect();
        handler.removeCallbacks(flushLoop);
        handler.post(flushLoop);
        return START_STICKY;
    }

    private void loadSettings() {
        baseUrl = SecureStore.get(this, "server", "");
        patientId = SecureStore.get(this, "patient", "");
        token = SecureStore.get(this, "token", "");
        deviceAddress = SecureStore.get(this, "device_address", "");
        deviceName = SecureStore.get(this, "device_name", "Bluetooth wearable");
        if (!queueLoaded) restoreQueue();
    }

    private synchronized void restoreQueue() {
        try {
            JSONArray stored = new JSONArray(SecureStore.get(this, "reading_queue", "[]"));
            for (int i = Math.max(0, stored.length() - MAX_QUEUE); i < stored.length(); i++) {
                pendingReadings.add(stored.getJSONObject(i));
            }
        } catch (Exception ignored) {
            pendingReadings.clear();
        }
        queueLoaded = true;
        queueDirty = false;
    }

    private synchronized void persistQueue() {
        if (!queueDirty) return;
        try {
            if (pendingReadings.isEmpty()) {
                SecureStore.remove(this, "reading_queue");
            } else {
                JSONArray stored = new JSONArray();
                for (JSONObject row : pendingReadings) stored.put(row);
                SecureStore.put(this, "reading_queue", stored.toString());
            }
            queueDirty = false;
        } catch (Exception e) {
            updateNotification("Queue save issue · keep the app open while syncing");
        }
    }

    private void connect() {
        if (stopping || !hasConnectPermission()) return;
        try {
            BluetoothManager manager = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                updateNotification("Bluetooth is off · monitoring paused");
                retryConnect();
                return;
            }
            BluetoothDevice device = adapter.getRemoteDevice(deviceAddress);
            gatt = Build.VERSION.SDK_INT >= 23
                    ? device.connectGatt(this, false, callback, BluetoothDevice.TRANSPORT_LE)
                    : device.connectGatt(this, false, callback);
            updateNotification("Connecting to " + safeName() + "…");
        } catch (Exception e) {
            updateNotification("Could not connect · retrying");
            retryConnect();
        }
    }

    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt bluetoothGatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                updateNotification("Connected · discovering measurements");
                try { bluetoothGatt.discoverServices(); }
                catch (SecurityException e) { updateNotification("Bluetooth permission was removed"); }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                closeGatt();
                updateNotification("Wearable disconnected · retrying");
                retryConnect();
            }
        }

        @Override public void onServicesDiscovered(BluetoothGatt bluetoothGatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                updateNotification("Could not read sensor profiles · retrying");
                retryConnect();
                return;
            }
            pendingSubscriptions.clear();
            addIfSupported(bluetoothGatt, HEART_SERVICE, HEART_MEASUREMENT);
            addIfSupported(bluetoothGatt, OX_SERVICE, OX_CONTINUOUS);
            addIfSupported(bluetoothGatt, OX_SERVICE, OX_SPOT);
            addIfSupported(bluetoothGatt, BP_SERVICE, BP_MEASUREMENT);
            addIfSupported(bluetoothGatt, TEMP_SERVICE, TEMP_MEASUREMENT);
            if (pendingSubscriptions.isEmpty()) {
                updateNotification("Wearable has no supported live health service");
                retryConnect();
            } else {
                subscribeNext(bluetoothGatt);
            }
        }

        @Override public void onDescriptorWrite(BluetoothGatt bluetoothGatt, BluetoothGattDescriptor descriptor, int status) {
            subscribeNext(bluetoothGatt);
        }

        @Override public void onCharacteristicChanged(BluetoothGatt bluetoothGatt, BluetoothGattCharacteristic characteristic) {
            byte[] value = characteristic.getValue();
            if (value != null) parse(characteristic.getUuid(), value);
        }

        @Override public void onCharacteristicChanged(BluetoothGatt bluetoothGatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (value != null) parse(characteristic.getUuid(), value);
        }

        @Override public void onCharacteristicRead(BluetoothGatt bluetoothGatt, BluetoothGattCharacteristic characteristic, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic.getValue() != null) {
                parse(characteristic.getUuid(), characteristic.getValue());
            }
        }
    };

    private void addIfSupported(BluetoothGatt bluetoothGatt, UUID serviceId, UUID characteristicId) {
        try {
            BluetoothGattCharacteristic characteristic = bluetoothGatt.getService(serviceId).getCharacteristic(characteristicId);
            int properties = characteristic.getProperties();
            if ((properties & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0) {
                pendingSubscriptions.add(characteristic);
            } else if ((properties & BluetoothGattCharacteristic.PROPERTY_READ) != 0) {
                bluetoothGatt.readCharacteristic(characteristic);
            }
        } catch (Exception ignored) {
            // A device may expose only a subset of standard GATT health profiles.
        }
    }

    private void subscribeNext(BluetoothGatt bluetoothGatt) {
        BluetoothGattCharacteristic characteristic = pendingSubscriptions.poll();
        if (characteristic == null || !hasConnectPermission()) {
            updateNotification("Connected · listening for supported sensor readings");
            return;
        }
        try {
            bluetoothGatt.setCharacteristicNotification(characteristic, true);
            BluetoothGattDescriptor descriptor = characteristic.getDescriptor(CCCD);
            if (descriptor == null) {
                subscribeNext(bluetoothGatt);
                return;
            }
            byte[] enable = (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
                    ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                    : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
            if (Build.VERSION.SDK_INT >= 33) bluetoothGatt.writeDescriptor(descriptor, enable);
            else {
                descriptor.setValue(enable);
                bluetoothGatt.writeDescriptor(descriptor);
            }
        } catch (Exception e) {
            subscribeNext(bluetoothGatt);
        }
    }

    private void parse(UUID characteristic, byte[] value) {
        try {
            if (HEART_MEASUREMENT.equals(characteristic) && value.length >= 2) {
                int flags = value[0] & 255;
                boolean is16Bit = (flags & 1) != 0;
                if (is16Bit && value.length < 3) return;
                int rate = is16Bit
                        ? ((value[2] & 255) << 8) | (value[1] & 255)
                        : value[1] & 255;
                addReading("heart_rate", rate, "bpm");
            } else if ((OX_CONTINUOUS.equals(characteristic) || OX_SPOT.equals(characteristic)) && value.length >= 5) {
                addReading("spo2", sfloat(value, 1), "%");
                addReading("heart_rate", sfloat(value, 3), "bpm");
            } else if (BP_MEASUREMENT.equals(characteristic) && value.length >= 7) {
                int flags = value[0] & 255;
                // IEEE-11073 BP flag bit 0 means the pressure values use kPa.
                double scale = (flags & 1) != 0 ? 7.50062 : 1.0;
                addReading("systolic", sfloat(value, 1) * scale, "mmHg");
                addReading("diastolic", sfloat(value, 3) * scale, "mmHg");
            } else if (TEMP_MEASUREMENT.equals(characteristic) && value.length >= 5) {
                double temperature = ieee11073Float(value, 1);
                if ((value[0] & 1) != 0) temperature = (temperature - 32.0) * 5.0 / 9.0;
                addReading("temperature_c", temperature, "°C");
            }
        } catch (Exception ignored) {
            // Ignore malformed sensor packets rather than creating guessed readings.
        }
    }

    private double sfloat(byte[] bytes, int offset) {
        int raw = (bytes[offset] & 255) | ((bytes[offset + 1] & 255) << 8);
        int mantissa = raw & 0x0fff;
        if ((mantissa & 0x0800) != 0) mantissa -= 0x1000;
        int exponent = (raw >> 12) & 0x0f;
        if ((exponent & 0x08) != 0) exponent -= 0x10;
        return mantissa * Math.pow(10, exponent);
    }

    private double ieee11073Float(byte[] bytes, int offset) {
        long raw = ((long) bytes[offset] & 255)
                | (((long) bytes[offset + 1] & 255) << 8)
                | (((long) bytes[offset + 2] & 255) << 16)
                | (((long) bytes[offset + 3] & 255) << 24);
        int mantissa = (int) (raw & 0x00ffffffL);
        if ((mantissa & 0x00800000) != 0) mantissa -= 0x01000000;
        int exponent = (byte) ((raw >> 24) & 255);
        return mantissa * Math.pow(10, exponent);
    }

    private void addReading(String metric, double value, String unit) {
        if (!Double.isFinite(value)) return;
        double min = metric.equals("spo2") ? 50 : metric.equals("heart_rate") ? 20 :
                metric.equals("temperature_c") ? 25 : metric.equals("systolic") ? 50 : 25;
        double max = metric.equals("spo2") ? 100 : metric.equals("heart_rate") ? 260 :
                metric.equals("temperature_c") ? 45 : metric.equals("systolic") ? 280 : 180;
        if (value < min || value > max) return;
        try {
            JSONObject row = new JSONObject();
            row.put("metric", metric);
            row.put("value", Math.round(value * 10.0) / 10.0);
            row.put("unit", unit);
            row.put("observed_at", Instant.now().toString());
            synchronized (this) {
                while (pendingReadings.size() >= MAX_QUEUE) pendingReadings.poll();
                pendingReadings.add(row);
                queueDirty = true;
            }
            updateNotification("Connected · readings queued for secure sync");
        } catch (Exception ignored) {}
    }

    private void flushBatch() {
        if (!flushing.compareAndSet(false, true)) return;
        io.execute(() -> {
            try {
                int count;
                JSONArray batch = new JSONArray();
                synchronized (this) {
                    count = Math.min(BATCH_SIZE, pendingReadings.size());
                    int index = 0;
                    for (JSONObject row : pendingReadings) {
                        if (index++ >= count) break;
                        batch.put(row);
                    }
                }
                if (count == 0) return;
                JSONObject payload = new JSONObject();
                payload.put("consent", true);
                payload.put("source", "android_ble");
                payload.put("device_name", safeName());
                payload.put("readings", batch);

                URL url = new URL(baseUrl + "/api/v2/patients/" + patientId + "/wearables");
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(15000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Authorization", "Bearer " + token);
                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
                int code = connection.getResponseCode();
                connection.disconnect();
                if (code >= 200 && code < 300) {
                    synchronized (this) {
                        for (int i = 0; i < count && !pendingReadings.isEmpty(); i++) pendingReadings.poll();
                        queueDirty = true;
                    }
                    updateNotification("Connected · readings synced");
                } else if (code == 401 || code == 403) {
                    updateNotification("Sync paused · reauthorize this Android companion in OncoBrief");
                } else {
                    updateNotification("Sync unavailable · readings queued securely");
                }
            } catch (Exception e) {
                updateNotification("Offline · readings queued securely for retry");
            } finally {
                persistQueue();
                flushing.set(false);
            }
        });
    }

    private void retryConnect() {
        handler.removeCallbacks(reconnectTask);
        handler.postDelayed(reconnectTask, 12000);
    }

    private void closeGatt() {
        if (gatt != null) {
            try { gatt.disconnect(); } catch (Exception ignored) {}
            try { gatt.close(); } catch (Exception ignored) {}
            gatt = null;
        }
    }

    private String safeName() {
        return deviceName == null || deviceName.isEmpty() ? "Bluetooth wearable" : deviceName;
    }

    private boolean hasConnectPermission() {
        return Build.VERSION.SDK_INT < 31 ||
                checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void stopMonitoring() {
        stopping = true;
        handler.removeCallbacks(flushLoop);
        handler.removeCallbacks(reconnectTask);
        closeGatt();
        persistQueue();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void startAsForeground(String status) {
        Intent stopIntent = new Intent(this, MonitorService.class).setAction(ACTION_STOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent stop = PendingIntent.getService(this, 10, stopIntent, flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        Notification notification = builder.setContentTitle("OncoBrief wearable monitoring")
                .setContentText(status)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(0, "Stop", stop).build())
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification(String status) {
        if (Build.VERSION.SDK_INT < 26) {
            startAsForeground(status);
            return;
        }
        Intent stopIntent = new Intent(this, MonitorService.class).setAction(ACTION_STOP);
        PendingIntent stop = PendingIntent.getService(this, 10, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, CHANNEL)
                .setContentTitle("OncoBrief wearable monitoring")
                .setContentText(status)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(0, "Stop", stop).build())
                .build();
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID, notification);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Wearable monitoring", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows whether OncoBrief is connected to a wearable and syncing readings.");
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            manager.createNotificationChannel(channel);
        }
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        handler.removeCallbacks(flushLoop);
        handler.removeCallbacks(reconnectTask);
        closeGatt();
        persistQueue();
        io.shutdownNow();
        super.onDestroy();
    }
}
