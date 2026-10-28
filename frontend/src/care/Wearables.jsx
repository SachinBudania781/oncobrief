import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bluetooth,
  Footprints,
  HeartPulse,
  Info,
  Moon,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Watch,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel } from "./UI";
import { request, useResource } from "./client";

const SERVICE_UUIDS = [
  "heart_rate",
  "blood_pressure",
  "pulse_oximeter",
  "health_thermometer",
];
const MEASUREMENTS = {
  heart_rate: "heart_rate_measurement",
  blood_pressure: "blood_pressure_measurement",
  pulse_oximeter_spot: "plx_spot_check_measurement",
  pulse_oximeter_continuous: "plx_continuous_measurement",
  temperature: "temperature_measurement",
};
const METRICS = {
  heart_rate: { label: "Heart rate", unit: "bpm", color: "#31826c", icon: HeartPulse },
  spo2: { label: "Oxygen saturation", unit: "%", color: "#4b83b6", icon: Activity },
  systolic: { label: "Systolic pressure", unit: "mmHg", color: "#b07051", icon: Activity },
  diastolic: { label: "Diastolic pressure", unit: "mmHg", color: "#cf9c67", icon: Activity },
  steps: { label: "Steps", unit: "steps", color: "#638765", icon: Footprints },
  distance_km: { label: "Walking distance", unit: "km", color: "#4b83b6", icon: Footprints },
  active_minutes: { label: "Active time", unit: "min", color: "#ac8857", icon: Activity },
  sleep_hours: { label: "Sleep", unit: "h", color: "#7470a3", icon: Moon },
  temperature_c: { label: "Body temperature", unit: "°C", color: "#b07051", icon: Thermometer },
};
const RANGE_OPTIONS = [7, 30, 90, 365];

function sfloat(view, offset = 0) {
  if (offset + 2 > view.byteLength) return NaN;
  const raw = view.getUint16(offset, true);
  let mantissa = raw & 0x0fff;
  let exponent = raw >> 12;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  if (exponent >= 0x8) exponent -= 0x10;
  const value = mantissa * Math.pow(10, exponent);
  return Number.isFinite(value) ? value : NaN;
}

function demoSeries(metric, days) {
  const count = Math.min(days, 90);
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const day = count - index - 1;
    const date = new Date(now);
    date.setDate(date.getDate() - day);
    date.setHours(20, 0, 0, 0);
    const wave = Math.sin(index * 0.61);
    const seed = (index * 37 + 11) % 17;
    const values = {
      heart_rate: 67 + Math.round((wave + 1) * 5 + seed % 4),
      spo2: 96 + (seed % 4),
      systolic: 111 + Math.round((wave + 1) * 5 + seed % 4),
      diastolic: 70 + Math.round((wave + 1) * 3 + seed % 3),
      steps: 3200 + ((index * 733 + 913) % 6100),
      distance_km: Number((2.1 + ((index * 31) % 79) / 10).toFixed(1)),
      active_minutes: 18 + ((index * 13) % 75),
      sleep_hours: Number((6 + ((index * 11) % 28) / 10).toFixed(1)),
      temperature_c: Number((36.3 + ((index * 7) % 8) / 10).toFixed(1)),
    };
    return {
      metric,
      value: values[metric],
      unit: METRICS[metric].unit,
      observed_at: date.toISOString(),
      source: "demo",
    };
  });
}

function shortDate(value) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function latestValue(readings, metric, fallback) {
  const rows = readings.filter((row) => row.metric === metric);
  return rows.length ? rows[rows.length - 1] : fallback?.[fallback.length - 1];
}

export default function Wearables({ pid, demo = false, viewerRole = "patient", activityFocus = 0 }) {
  const resource = useResource("/v2/patients/" + encodeURIComponent(pid) + "/wearables?days=365", 30000);
  const readings = resource.data?.items || [];
  const canCapture = ["patient", "caregiver"].includes(viewerRole);
  const canReviewActivity = ["caregiver", "doctor", "nurse", "navigator", "frontdesk", "admin"].includes(viewerRole);
  const activityThreshold = resource.data?.activity_threshold_steps;
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState(viewerRole === "patient" ? "heart_rate" : "steps");
  useEffect(() => {
    if (activityFocus) setMetric("steps");
  }, [activityFocus]);
  const [consent, setConsent] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liveValues, setLiveValues] = useState({});
  const [manual, setManual] = useState({ steps: "", distance_km: "", active_minutes: "", sleep_hours: "" });
  const queueRef = useRef([]);
  const lastSavedAtRef = useRef({});
  const deviceRef = useRef(null);
  const listenersRef = useRef([]);
  const flushBusyRef = useRef(false);
  const flushRef = useRef(null);

  const demoForMetric = useMemo(() => {
    const out = {};
    Object.keys(METRICS).forEach((key) => {
      if (!readings.some((row) => row.metric === key)) out[key] = demo ? demoSeries(key, days) : [];
    });
    return out;
  }, [days, demo, readings]);

  const effectiveReadings = useMemo(() => {
    if (!demo) return readings;
    return Object.keys(METRICS).flatMap((key) => {
      const actual = readings.filter((row) => row.metric === key);
      return actual.length ? actual : demoForMetric[key] || [];
    });
  }, [demo, demoForMetric, readings]);

  const chartRows = useMemo(() => effectiveReadings
    .filter((row) => row.metric === metric)
    .map((row) => ({
      ...row,
      time: new Date(row.observed_at).getTime(),
      label: shortDate(row.observed_at),
    }))
    .filter((row) => Number.isFinite(row.time) && row.time >= Date.now() - days * 86400000)
    .slice(-1500), [days, effectiveReadings, metric]);

  const latestDemo = useMemo(() => {
    const out = {};
    Object.keys(METRICS).forEach((key) => { out[key] = demoSeries(key, 30); });
    return out;
  }, []);

  const flush = useCallback(async () => {
    if (flushBusyRef.current || queueRef.current.length === 0) return;
    flushBusyRef.current = true;
    const batch = queueRef.current.splice(0, 100);
    try {
      await request("/v2/patients/" + encodeURIComponent(pid) + "/wearables", "POST", {
        consent: true,
        source: "bluetooth",
        device_name: deviceName,
        readings: batch,
      });
      resource.refresh();
      setError("");
    } catch (err) {
      queueRef.current = [...batch, ...queueRef.current].slice(-200);
      setError("Some readings could not be saved. They will retry while this page stays open. " + err.message);
    } finally {
      flushBusyRef.current = false;
    }
  }, [deviceName, pid, resource.refresh]);

  flushRef.current = flush;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (connected || queueRef.current.length) flushRef.current?.();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [connected]);
  const enqueue = useCallback((readingMetric, value, unit) => {
    if (!Number.isFinite(value)) return;
    const limits = {
      heart_rate: [20, 260], spo2: [50, 100], systolic: [50, 280], diastolic: [25, 180], temperature_c: [25, 45],
    }[readingMetric];
    if (!limits || value < limits[0] || value > limits[1]) return;
    const now = Date.now();
    if (now - (lastSavedAtRef.current[readingMetric] || 0) < 30000) {
      setLiveValues((old) => ({ ...old, [readingMetric]: { value, unit, observed_at: new Date().toISOString() } }));
      return;
    }
    lastSavedAtRef.current[readingMetric] = now;
    const point = { metric: readingMetric, value: Number(value.toFixed(1)), unit, observed_at: new Date().toISOString() };
    queueRef.current.push(point);
    setLiveValues((old) => ({ ...old, [readingMetric]: point }));
  }, []);

  const detachDevice = useCallback(() => {
    listenersRef.current.forEach((cleanup) => cleanup());
    listenersRef.current = [];
    const device = deviceRef.current;
    deviceRef.current = null;
    if (device?.gatt?.connected) device.gatt.disconnect();
    setConnected(false);
  }, []);

  useEffect(() => () => {
    listenersRef.current.forEach((cleanup) => cleanup());
    if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect();
    deviceRef.current = null;
  }, []);

  const connect = async () => {
    setError("");
    setMessage("");
    if (!consent) {
      setError("Please agree before saving wearable readings to this patient record.");
      return;
    }
    if (!window.isSecureContext || !navigator.bluetooth) {
      setError("Bluetooth access is unavailable here. Use Chrome or Edge on a supported device over HTTPS (or localhost).");
      return;
    }
    setConnecting(true);
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: ["heart_rate"] },
          { services: ["blood_pressure"] },
          { services: ["pulse_oximeter"] },
          { services: ["health_thermometer"] },
          { namePrefix: "WHOOP" },
        ],
        optionalServices: SERVICE_UUIDS,
      });
      deviceRef.current = device;
      setDeviceName(device.name || "Bluetooth wearable");
      device.addEventListener("gattserverdisconnected", () => {
        setConnected(false);
        flushRef.current?.();
        setMessage("Device disconnected. Saved readings remain in your history.");
      }, { once: true });

      const server = await device.gatt.connect();
      let streams = 0;
      const watch = async (serviceId, characteristicId, handleValue) => {
        try {
          const service = await server.getPrimaryService(serviceId);
          const characteristic = await service.getCharacteristic(characteristicId);
          await characteristic.startNotifications();
          const listener = (event) => handleValue(event.target.value);
          characteristic.addEventListener("characteristicvaluechanged", listener);
          listenersRef.current.push(() => {
            characteristic.removeEventListener("characteristicvaluechanged", listener);
            if (characteristic.stopNotifications) characteristic.stopNotifications().catch(() => {});
          });
          streams += 1;
        } catch {
          // A wearable may expose only a subset of standard services.
        }
      };

      await watch("heart_rate", MEASUREMENTS.heart_rate, (view) => {
        if (!view.byteLength) return;
        const flags = view.getUint8(0);
        const value = flags & 1 ? view.getUint16(1, true) : view.getUint8(1);
        enqueue("heart_rate", value, "bpm");
      });

      await watch("blood_pressure", MEASUREMENTS.blood_pressure, (view) => {
        if (view.byteLength < 7) return;
        const flags = view.getUint8(0);
        const scale = flags & 1 ? 7.50062 : 1;
        enqueue("systolic", sfloat(view, 1) * scale, "mmHg");
        enqueue("diastolic", sfloat(view, 3) * scale, "mmHg");
      });

      const readOximeter = (view) => {
        if (view.byteLength < 5) return;
        enqueue("spo2", sfloat(view, 1), "%");
        enqueue("heart_rate", sfloat(view, 3), "bpm");
      };
      await watch("pulse_oximeter", MEASUREMENTS.pulse_oximeter_continuous, readOximeter);
      await watch("pulse_oximeter", MEASUREMENTS.pulse_oximeter_spot, readOximeter);

      await watch("health_thermometer", MEASUREMENTS.temperature, (view) => {
        if (view.byteLength < 5) return;
        const flags = view.getUint8(0);
        let celsius = view.getFloat32(1, true);
        if (flags & 1) celsius = (celsius - 32) * 5 / 9;
        enqueue("temperature_c", celsius, "°C");
      });

      if (!streams) {
        device.gatt.disconnect();
        throw new Error("This device did not expose a supported live health measurement. Try a Bluetooth heart-rate monitor, blood-pressure cuff, or pulse oximeter.");
      }
      setConnected(true);
      setMessage("Connected to " + (device.name || "wearable") + ". Live capture runs only while this page is open.");
    } catch (err) {
      setError(err.name === "NotFoundError" ? "No device was selected." : (err.message || "Could not connect to that device."));
      if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect();
      deviceRef.current = null;
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  };

  const saveManualActivity = async (event) => {
    event.preventDefault();
    setError("");
    if (!consent) {
      setError("Please agree before saving activity readings to this patient record.");
      return;
    }
    const now = new Date().toISOString();
    const units = { steps: "steps", distance_km: "km", active_minutes: "min", sleep_hours: "h" };
    const points = Object.entries(manual)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => ({ metric: key, value: Number(value), unit: units[key], observed_at: now }));
    if (!points.length) {
      setError("Enter at least one daily activity value.");
      return;
    }
    try {
      await request("/v2/patients/" + encodeURIComponent(pid) + "/wearables", "POST", {
        consent: true,
        source: "manual",
        device_name: "Manual activity entry",
        readings: points,
      });
      setManual({ steps: "", distance_km: "", active_minutes: "", sleep_hours: "" });
      setMessage("Activity saved to your longitudinal trends.");
      resource.refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const chartIsDemo = demo && !readings.some((row) => row.metric === metric);
  const activeReadings = readings;
  const heart = latestValue(activeReadings, "heart_rate", demo ? latestDemo.heart_rate : undefined);
  const oxygen = latestValue(activeReadings, "spo2", demo ? latestDemo.spo2 : undefined);
  const systolic = latestValue(activeReadings, "systolic", demo ? latestDemo.systolic : undefined);
  const diastolic = latestValue(activeReadings, "diastolic", demo ? latestDemo.diastolic : undefined);
  const steps = latestValue(activeReadings, "steps", demo ? latestDemo.steps : undefined);
  const distance = latestValue(activeReadings, "distance_km", demo ? latestDemo.distance_km : undefined);
  const activeMinutes = latestValue(activeReadings, "active_minutes", demo ? latestDemo.active_minutes : undefined);
  const stats = [
    { label: "Heart rate", point: heart, unit: "bpm", icon: HeartPulse },
    { label: "Oxygen", point: oxygen, unit: "%", icon: Activity },
    {
      label: "Blood pressure",
      point: systolic && diastolic ? (systolic.source === "bluetooth" ? systolic : diastolic) : null,
      unit: "mmHg",
      icon: Activity,
      value: systolic && diastolic ? systolic.value + " / " + diastolic.value : "—",
    },
    { label: "Latest steps", point: steps, unit: "steps", icon: Footprints },
    { label: "Walking distance", point: distance, unit: "km", icon: Footprints },
    { label: "Active time", point: activeMinutes, unit: "min", icon: Activity },
  ];
  return (
    <div className="ob-wearables">
      <header className="ob-wear-head">
        <div>
          <p className="ob-wear-eyebrow">YOUR WELLBEING, OVER TIME</p>
          <h1>Wearables & trends</h1>
          <p>Bring supported health readings and daily activity together in one view.</p>
        </div>
        <div className={"ob-wear-device-state " + (connected ? "is-connected" : "")}>
          <span className="ob-wear-dot" />
          <span>{connected ? "Live device connected" : canCapture ? "No device connected" : "Patient trend history"}</span>
        </div>
      </header>

      <div className="ob-wear-note">
        <Info size={18} />
        <span>Trends are for discussion with your care team, not diagnosis or emergency monitoring. Your watch may not measure every metric shown.</span>
      </div>

      {canCapture && <Panel title="Connect a Bluetooth device" hint="Only standard Bluetooth health services are read. The browser asks you to choose a nearby device.">
        <div className="ob-wear-connect">
          <div className="ob-wear-device-icon"><Watch size={24} /></div>
          <div className="ob-wear-connect-copy">
            <b>{connected ? deviceName : "Connect a wrist band or health sensor"}</b>
            <span>{connected ? "Live readings are saved with timestamps while this page remains open." : "Heart rate, blood pressure, pulse oximetry and temperature are captured when the device exposes a standard Bluetooth profile."}</span>
          </div>
          {connected ? (
            <button className="btn ob-wear-secondary" onClick={async () => { await flush(); detachDevice(); setMessage("Disconnected. Your saved trend history is kept."); }}>
              Disconnect
            </button>
          ) : (
            <button className="btn ob-wear-primary" disabled={connecting || !consent} onClick={connect}>
              <Bluetooth size={17} />{connecting ? "Connecting…" : "Find a device"}
            </button>
          )}
        </div>
        <label className="care-check ob-wear-consent">
          <input type="checkbox" checked={consent} disabled={connected} onChange={(event) => setConsent(event.target.checked)} />
          I agree to save wearable and activity readings to this patient record.
        </label>
        <p className="ob-wear-caption">Bluetooth capture stops when you close this page or the device disconnects. No device identifier is stored.</p>
        {message && <p className="ob-wear-message" role="status">{message}</p>}
        {error && <p className="care-error" role="alert">{error}</p>}
      </Panel>}

      <section className="ob-wear-stats" aria-label="Latest health and activity readings">
        {stats.map(({ label, point, unit, icon: Icon, value }) => (
          <article className="ob-wear-stat" key={label}>
            <span className="ob-wear-stat-icon"><Icon size={18} /></span>
            <span className="ob-wear-stat-label">{label}</span>
            <b>{value || (point ? Number(point.value).toLocaleString("en-IN") : "—")}<small> {unit}</small></b>
            <span className="ob-wear-stat-source">{point?.source === "bluetooth" ? "From connected device" : point?.source === "manual" ? "Manual entry" : point?.source === "demo" ? "Illustrative demo" : "No readings"}</span>
          </article>
        ))}
      </section>

      <Panel title="Longitudinal trends" hint={canReviewActivity && activityThreshold != null
        ? "Review saved readings over time. The dashed steps line is the " + activityThreshold.toLocaleString("en-IN") + " daily-step review threshold; low-activity notices go to assigned care team members only."
        : "Review readings over time. The chart uses saved patient data when available."}>
        <div className="ob-wear-chart-tools">
          <label className="field">
            Measure
            <select className="select" value={metric} onChange={(event) => setMetric(event.target.value)}>
              {Object.entries(METRICS).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}
            </select>
          </label>
          <label className="field">
            Time range
            <select className="select" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              {RANGE_OPTIONS.map((value) => <option key={value} value={value}>{value === 365 ? "1 year" : value + " days"}</option>)}
            </select>
          </label>
          <button className="btn ob-wear-refresh" onClick={resource.refresh} aria-label="Refresh wearable readings"><RefreshCw size={16} />Refresh</button>
        </div>
        <div className="ob-wear-chart-title">
          <div><b>{METRICS[metric].label}</b><span>{chartIsDemo ? "Illustrative sample data · not connected" : (chartRows.length ? "Saved readings" : "No readings yet")}</span></div>
          <strong style={{ color: METRICS[metric].color }}>{METRICS[metric].unit}</strong>
        </div>
        {resource.error ? (
          <p className="care-error" role="alert">{resource.error}</p>
        ) : chartRows.length ? (
          <div className="ob-wear-chart">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartRows} margin={{ top: 12, right: 10, left: 0, bottom: 3 }}>
                <defs>
                  <linearGradient id="wearableTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={METRICS[metric].color} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={METRICS[metric].color} stopOpacity={0.015} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e6ece8" />
                <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} tickCount={6} axisLine={false} tickLine={false} fontSize={11} />
                <YAxis
                  dataKey="value"
                  domain={metric === "steps" && canReviewActivity && activityThreshold != null
                    ? [0, (dataMax) => Math.ceil(Math.max(dataMax, activityThreshold) * 1.1)]
                    : ["auto", "auto"]}
                  width={42}
                  axisLine={false}
                  tickLine={false}
                  fontSize={11}
                />
                {metric === "steps" && canReviewActivity && activityThreshold != null && (
                  <ReferenceLine
                    y={activityThreshold}
                    stroke="#b65c53"
                    strokeDasharray="6 5"
                    label={{ value: "Review line · " + activityThreshold.toLocaleString("en-IN"), position: "insideTopRight", fill: "#98463e", fontSize: 11 }}
                  />
                )}
                <ChartTooltip
                  labelFormatter={(value) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  formatter={(value) => [Number(value).toLocaleString("en-IN") + " " + METRICS[metric].unit, METRICS[metric].label]}
                  contentStyle={{ borderRadius: 14, borderColor: "#e4ebe6", boxShadow: "0 12px 30px rgba(30,55,45,.10)" }}
                />
                <Area type="monotone" dataKey="value" stroke={METRICS[metric].color} strokeWidth={2.5} fill="url(#wearableTrendFill)" activeDot={{ r: 5, strokeWidth: 0 }} dot={chartRows.length < 18 ? { r: 2.5, strokeWidth: 0 } : false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="ob-wear-empty"><Activity size={24} /><b>No readings in this time range yet</b><span>Connect a supported sensor or enter daily activity below.</span></div>
        )}
        {liveValues[metric] && <p className="ob-wear-live-line"><span className="ob-wear-live-pulse" />Live {METRICS[metric].label.toLowerCase()}: <b>{liveValues[metric].value} {liveValues[metric].unit}</b></p>}
      </Panel>

      {canCapture && <Panel title="Add daily activity" hint="Steps, walking distance, active time and sleep usually come from a phone health platform or the device maker's account sync. Enter a daily total here if your device does not expose it over Bluetooth.">
        <form className="ob-wear-manual" onSubmit={saveManualActivity}>
          {[
            ["steps", "Steps", "steps", "200000", "1"],
            ["distance_km", "Distance walked", "km", "150", "0.1"],
            ["active_minutes", "Active time", "minutes", "1440", "1"],
            ["sleep_hours", "Sleep", "hours", "24", "0.1"],
          ].map(([key, label, unit, max, step]) => (
            <label className="field" key={key}>
              {label} <span className="ob-wear-unit">({unit})</span>
              <input className="input" type="number" min="0" max={max} step={step} value={manual[key]} onChange={(event) => setManual((old) => ({ ...old, [key]: event.target.value }))} placeholder="—" />
            </label>
          ))}
          <button className="btn ob-wear-primary" type="submit">Save daily activity</button>
        </form>
      </Panel>}

      <div className="ob-wear-compat">
        <div><Bluetooth size={19} /><p><b>Bluetooth standards</b><span>BLE devices exposing the standard heart-rate, blood-pressure, pulse-oximeter or thermometer service can stream while connected.</span></p></div>
        <div><Watch size={19} /><p><b>WHOOP & smart watches</b><span>WHOOP can broadcast heart rate when its HR broadcast mode is enabled. Historical recovery, sleep and workout summaries need its OAuth account connection; step counts depend on a separate vendor or phone-health feed.</span></p></div>
        <div><ShieldCheck size={19} /><p><b>Private by design</b><span>Only approved patient/caregiver accounts can write these readings. Each saved point is timestamped and attributed to Bluetooth or manual entry.</span></p></div>
      </div>
    </div>
  );
}