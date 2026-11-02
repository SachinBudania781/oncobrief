import assert from "node:assert/strict";
import test from "node:test";
import { heartRate, temperatureCelsius } from "../src/care/wearablePackets.mjs";

const packet = (...bytes) => new DataView(Uint8Array.from(bytes).buffer);

test("8-bit and 16-bit heart-rate measurements", () => {
  assert.equal(heartRate(packet(0, 72)), 72);
  assert.equal(heartRate(packet(1, 4, 1)), 260);
});

test("truncated heart-rate packets are ignored without throwing", () => {
  for (const view of [packet(), packet(0), packet(1, 72)]) {
    assert.ok(Number.isNaN(heartRate(view)));
  }
});

test("decimal Bluetooth temperature in Celsius and Fahrenheit", () => {
  // 3650 * 10^-2 = 36.50 C; 986 * 10^-1 = 98.6 F = 37 C.
  assert.equal(temperatureCelsius(packet(0, 0x42, 0x0e, 0, 0xfe)), 36.5);
  assert.ok(Math.abs(temperatureCelsius(packet(1, 0xda, 3, 0, 0xff)) - 37) < 1e-10);
});

test("unavailable and truncated thermometer samples are ignored", () => {
  assert.ok(Number.isNaN(temperatureCelsius(packet(0, 0xff, 0xff, 0x7f, 0))));
  assert.ok(Number.isNaN(temperatureCelsius(packet(0, 0, 0))));
});
