# OncoBrief Android wearable companion

This native Android companion keeps a foreground Bluetooth connection to a nearby sensor and uploads supported readings to the OncoBrief patient API. The React website remains the dashboard and care-team workspace.

## Setup

1. Sign in to the patient or caregiver portal over HTTPS and open **Wearables**.
2. Agree to the wearable consent, then choose **Generate Android setup code**. This creates a revocable credential scoped to that patient. It is shown once and expires after 90 days; revoke the linked device in the portal to stop future uploads.
3. Open this android folder in Android Studio, sync the Gradle project, install the app on an Android phone, and grant Bluetooth and notification permissions.
4. Paste the patient folder ID and setup code into the companion. Keep the patient app URL as shown unless your deployment uses a different origin.
5. Scan for and select a nearby device, then start monitoring. Android shows a persistent notification while the foreground service runs.
6. Doctors must sign patient-specific minimum vital thresholds in the Wearables section for low-reading alerts to be created. Notices go only to authorized caregivers and staff. Revoke the Android device in the portal to stop future uploads.

## Sensor support

The app listens for standard Bluetooth GATT Heart Rate, Pulse Oximeter, Blood Pressure, and Health Thermometer services when a device exposes them. Devices may expose only some measurements or no standard health profile at all. Heart rate and oxygen saturation are separate samples; oxygen saturation is the SpO₂ reading. Vendor-only functions such as WHOOP historical data need a separate authorized vendor integration.

The app periodically encrypts its unsent reading queue with Android Keystore and retries uploads while the service is active. Its server credential is patient-scoped, write-only for wearable readings, and can be revoked from the portal. Alerts currently create in-app notifications for assigned caregivers and staff; this companion does not send SMS or push alerts.

## Limits

This is a hackathon prototype, not a medical device or emergency alarm. Android can stop or delay background work; monitoring can pause after a phone restart, permission changes, battery restrictions, Bluetooth loss, device removal, or unsupported sensor behavior. The service must be started by the user and keeps a visible Android notification. The app cannot guarantee continuous 24/7 sensing, clinical-grade data quality, or timely delivery. Do not use it instead of a prescribed monitor or local escalation process.

Alerts require two distinct sensor readings within five minutes below a doctor-signed, patient-specific minimum. Repeated readings above the minimum resolve the active review state. The system labels these as readings for human review; it does not diagnose “low metabolic activity.”
