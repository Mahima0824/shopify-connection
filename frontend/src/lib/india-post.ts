export const INDIA_POST_HELP: Record<string, string> = {
  receiver_name: "As printed on parcel — e.g. KIRAN",
  receiver_mobile: "10 digits, no +91",
  receiver_pincode: "6 digits — auto-copies to DROP OFF PINCODE",
  weight_grams: "Grams, e.g. 930 — must be > 0",
  cod_value: "Required if CODR/COD = COD — must match UPI entry",
  barcode_no: "Leave blank to auto-generate EG...IN",
};

export type NewOrderValues = Record<string, unknown>;
export type NewOrderErrors = Record<string, string>;

const ORDER_QUERY_KEYS = [
  "search",
  "status",
  "cod_mode",
  "date_from",
  "date_to",
  "city",
  "pincode",
] as const;

export function validateNewOrder(v: NewOrderValues): NewOrderErrors {
  const errors: NewOrderErrors = {};
  const name = String(v.receiver_name ?? "").trim();
  if (!name) errors.receiver_name = "Receiver name required";
  if (!/^[0-9]{10}$/.test(String(v.receiver_mobile ?? "")))
    errors.receiver_mobile = "Mobile must be 10 digits";
  if (!/^[0-9]{6}$/.test(String(v.receiver_pincode ?? "")))
    errors.receiver_pincode = "PINCODE must be 6 digits";
  if (!(Number(v.weight_grams) > 0)) errors.weight_grams = "Weight must be > 0 grams";
  if (v.cod_mode === "COD" && !(Number(v.cod_value) > 0))
    errors.cod_value = "COD value required when COD";
  if (!String(v.receiver_add1 ?? "").trim())
    errors.receiver_add1 = "Address line 1 required";
  if (!String(v.receiver_city ?? "").trim()) errors.receiver_city = "City required";
  return errors;
}

export function buildOrderQuery(f: NewOrderValues): string {
  const q = new URLSearchParams();
  for (const k of ORDER_QUERY_KEYS) {
    const val = f[k];
    if (val) q.set(k, String(val));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function downloadXlsx(url: string, filename?: string): Promise<void> {
  const token = localStorage.getItem("token") ?? "";
  const r = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(`Download failed: ${r.status}`);

  let targetFilename = filename;

  // Extract filename from backend Content-Disposition header if available
  const disp = r.headers.get("content-disposition") || r.headers.get("Content-Disposition");
  if (disp) {
    const match = disp.match(/filename="?([^";]+)"?/);
    if (match && match[1]) {
      targetFilename = match[1].trim();
    }
  }

  // Fallback to generating timestamped filename if static or not provided
  if (!targetFilename || targetFilename === "india-post.xlsx") {
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, "0");
    const DD = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    targetFilename = `india-post_${YYYY}-${MM}-${DD}_${hh}-${mm}-${ss}.xlsx`;
  }

  const blob = await r.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = targetFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

export function newOrderDefaults(): Record<string, string | number> {
  return {
    sender_name: "Reshamgath",
    sender_add1: "FF-138/139, 2nd Floor, Rajhans Imperia",
    sender_city: "Surat",
    sender_state: "Gujarat",
    sender_pincode: "395002",
    sender_mobile: "9016822651",
    shape: "NROL",
    length_cm: 30,
    breadth_cm: 20,
    height_cm: 5,
    weight_grams: 930,
    cod_mode: "COD",
  };
}
