import React, { useEffect, useRef, useState } from "react";
import bwipjs from "bwip-js/browser";
import { isValidBarcode } from "../../lib/barcode";

export default function ParcelBarcode({ value, scale = 3 }: { value: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isValidBarcode(value)) {
      setErr(`Invalid barcode: ${value}`);
      return;
    }
    setErr(null);
    try {
      if (ref.current) {
        bwipjs.toCanvas(ref.current, { bcid: "code128", text: value, scale, height: 14, includetext: false });
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Render failed");
    }
  }, [value, scale]);
  if (err) return <p role="alert">{err}</p>;
  return <canvas ref={ref} aria-label={`Barcode ${value}`} />;
}
