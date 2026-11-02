export function heartRate(view) {
  if (view.byteLength < 2) return NaN;
  if (view.getUint8(0) & 1) return view.byteLength >= 3 ? view.getUint16(1, true) : NaN;
  return view.getUint8(1);
}

export function temperatureCelsius(view) {
  if (view.byteLength < 5) return NaN;
  // Bluetooth Health Thermometer uses IEEE-11073 FLOAT: a signed 24-bit
  // decimal mantissa and signed 8-bit exponent, not IEEE-754 float32.
  const raw = view.getUint32(1, true);
  const mantissaBits = raw & 0xffffff;
  if ([0x7ffffe, 0x7fffff, 0x800000, 0x800001, 0x800002].includes(mantissaBits)) return NaN;
  const mantissa = mantissaBits & 0x800000 ? mantissaBits - 0x1000000 : mantissaBits;
  const exponent = view.getInt8(4);
  const value = mantissa * 10 ** exponent;
  return view.getUint8(0) & 1 ? (value - 32) * 5 / 9 : value;
}
