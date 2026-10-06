// frontend/tests/scan-sound.test.tsx
import { expect, test, vi, beforeEach } from "vitest";
import { playScanBeep } from "../src/lib/scan-sound";

const osc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
const ctx = {
  state: "running",
  currentTime: 0,
  resume: vi.fn(),
  createOscillator: () => osc,
  createGain: () => gain,
  destination: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "AudioContext", { value: vi.fn(() => ctx), configurable: true });
});

test("scan beep plays an audible oscillator blip", () => {
  playScanBeep();
  expect(osc.start).toHaveBeenCalled();
  expect(osc.frequency.value).toBeGreaterThan(0);
  expect(gain.connect).toHaveBeenCalled();
});

test("silent when Web Audio is unavailable", () => {
  Object.defineProperty(window, "AudioContext", { value: undefined, configurable: true });
  expect(() => playScanBeep()).not.toThrow();
});
