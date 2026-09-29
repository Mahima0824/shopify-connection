"use client";
import React, { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";
import { shouldSuppress, LastScan } from "../../lib/scan-debounce";
import { playScanBeep } from "../../lib/scan-sound";

export type ScanErrorCode = "CAMERA_PERMISSION_DENIED" | "CAMERA_NOT_FOUND" | "CAMERA_NOT_READABLE" | "DECODER_ERROR" | "SCAN_TIMEOUT";

type Props = { onDetected: (v: string) => void; onError?: (code: ScanErrorCode, message: string) => void; active?: boolean };

export default function BarcodeScanner({ onDetected, onError, active = true }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastRef = useRef<LastScan>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!active) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    const reader = new BrowserMultiFormatReader();
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          fail("CAMERA_NOT_FOUND", "Camera needs a secure (HTTPS) page. Open this site over HTTPS or localhost.");
          return;
        }
        // Request permission FIRST: mobile browsers return an empty device
        // list (and blank labels) until access is granted, and each tunnel
        // URL is a fresh origin with no saved permission.
        try {
          const warmup = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
          warmup.getTracks().forEach((t) => t.stop());
        } catch (permErr: any) {
          if ((permErr?.name ?? "") === "NotAllowedError") {
            fail("CAMERA_PERMISSION_DENIED", "Camera access was denied. Allow permission and try again.");
            return;
          }
          throw permErr;
        }
        if (dead) return;
        const list = await BrowserMultiFormatReader.listVideoInputDevices();
        if (dead) return;
        setDevices(list);
        const rear = list.find((d) => /back|rear|environment/i.test(d.label)) ?? list[0];
        const chosen = deviceId ?? rear?.deviceId;
        if (!chosen) {
          fail("CAMERA_NOT_FOUND", "No camera found on this device.");
          return;
        }
        const controls = await reader.decodeFromVideoDevice(chosen, videoRef.current!, (result, err) => {
          if (result) {
            const v = result.getText();
            const now = Date.now();
            if (shouldSuppress(lastRef.current, v, now)) return;
            lastRef.current = { value: v, at: now };
            playScanBeep();
            onDetectedRef.current(v);
          } else if (err && !(err instanceof NotFoundException)) {
            fail("DECODER_ERROR", String(err?.message ?? err));
          }
        });
        if (dead) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        timer = setTimeout(() => fail("SCAN_TIMEOUT", "Barcode not detected. Move closer or improve lighting."), 30000);
      } catch (e: any) {
        const n = e?.name ?? "";
        if (n === "NotAllowedError") fail("CAMERA_PERMISSION_DENIED", "Camera access was denied. Allow permission and try again.");
        else if (n === "NotFoundError") fail("CAMERA_NOT_FOUND", "No camera found on this device.");
        else if (n === "NotReadableError") fail("CAMERA_NOT_READABLE", "Camera is busy or unreadable.");
        else fail("DECODER_ERROR", e?.message ?? "Decoder error.");
      }
    }
    function fail(code: ScanErrorCode, message: string) {
      if (!dead) {
        setError(message);
        onError?.(code, message);
      }
    }
    start();
    return () => {
      dead = true;
      clearTimeout(timer);
      try { controlsRef.current?.stop(); } catch { /* ignore */ }
      const el = videoRef.current as any;
      const stream = el?.srcObject as MediaStream | undefined;
      stream?.getTracks().forEach((t) => t.stop());
      if (el) el.srcObject = null;
    };
  }, [active, deviceId, onError]);

  if (!active) return null;
  return (
    <div>
      <video ref={videoRef} muted playsInline style={{ width: "100%", maxHeight: 320, background: "#000" }} aria-label="Camera viewfinder" />
      {devices.length > 1 && (
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Camera">
          {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
        </select>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
