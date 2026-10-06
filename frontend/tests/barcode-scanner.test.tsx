// frontend/tests/barcode-scanner.test.tsx
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { expect, test, vi, beforeEach } from "vitest";

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    static async listVideoInputDevices() {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === "videoinput");
    }
    async decodeFromVideoDevice() {
      return { stop() {} };
    }
  },
}));

import BarcodeScanner from "../src/components/scanner/BarcodeScanner";

const getUserMedia = vi.fn();
const enumerateDevices = vi.fn();

beforeEach(() => {
  getUserMedia.mockReset();
  enumerateDevices.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia, enumerateDevices },
    configurable: true,
  });
});

test("requests camera permission before enumerating devices", async () => {
  // Mobile browsers return [] until permission is granted.
  enumerateDevices.mockResolvedValue([]);
  getUserMedia.mockResolvedValue({ getTracks: () => [] });
  const onError = vi.fn();
  render(<BarcodeScanner onDetected={() => {}} onError={onError} />);
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  // Permission granted but truly no camera -> NOT_FOUND (not a crash).
  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith("CAMERA_NOT_FOUND", expect.anything())
  );
});

test("missing mediaDevices reports secure-context message", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    value: undefined,
    configurable: true,
  });
  const onError = vi.fn();
  render(<BarcodeScanner onDetected={() => {}} onError={onError} />);
  await waitFor(() =>
    expect(onError).toHaveBeenCalledWith("CAMERA_NOT_FOUND", expect.stringMatching(/HTTPS/i))
  );
});
