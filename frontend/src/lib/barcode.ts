export function normalizeBarcode(v: string): string {
  return (v || "").trim().toUpperCase();
}

export function isValidBarcode(v: string): boolean {
  const s = normalizeBarcode(v);
  return /^P\d{8}$/.test(s) || /^PKG-\d{10}$/.test(s);
}
