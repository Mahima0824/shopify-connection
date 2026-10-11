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
  "carrier",
  "page",
  "page_size",
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

export type SpeedPostZone = "LOCAL" | "SAME_STATE" | "NATIONAL" | "REMOTE";

export interface ZoneInfo {
  zone: SpeedPostZone;
  label: string;
}

export function detectSpeedPostZone(
  senderPin?: string | number | null,
  receiverPin?: string | number | null
): ZoneInfo {
  const s = String(senderPin || "395002").trim().replace(/\D/g, "");
  const r = String(receiverPin || "").trim().replace(/\D/g, "");

  if (!r || r.length !== 6) {
    return { zone: "NATIONAL", label: "National (201–1000 km)" };
  }

  // Same 3 digits -> Local city (e.g. 395xxx)
  if (s.length === 6 && s.substring(0, 3) === r.substring(0, 3)) {
    return { zone: "LOCAL", label: "Local (Same City)" };
  }

  // Same 2 digits -> Intra-state / Regional (e.g. 39xxxx Gujarat)
  if (s.length === 6 && s.substring(0, 2) === r.substring(0, 2)) {
    return { zone: "SAME_STATE", label: "Intra-State (Up to 200 km)" };
  }

  // Special / Remote zones (J&K: 18, 19 | North East: 79 | Andaman: 74)
  const prefix2 = r.substring(0, 2);
  if (["18", "19", "79", "74"].includes(prefix2)) {
    return { zone: "REMOTE", label: "Remote Zone (>2000 km)" };
  }

  return { zone: "NATIONAL", label: "National (201–1000 km)" };
}

export type CourierCode = "INDIA_POST" | "DELHIVERY" | "DTDC" | "BLUEDART";

export interface SingleCourierEstimate {
  code: CourierCode;
  name: string;
  badgeBg: string;
  badgeText: string;
  logoEmoji: string;
  actualWeightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  volumetricWeightGrams: number;
  billableWeightGrams: number;
  zone: SpeedPostZone;
  zoneLabel: string;
  basePostage: number;
  docketFee: number;
  fuelSurcharge: number;
  codFee: number;
  gstAmount: number;
  totalCharge: number;
  isCheapest?: boolean;
}

export interface MultiCourierEstimate {
  actualWeightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  volumetricWeightGrams: number;
  billableWeightGrams: number;
  zone: SpeedPostZone;
  zoneLabel: string;
  estimates: Record<CourierCode, SingleCourierEstimate>;
  cheapestCourier: SingleCourierEstimate;
}

export interface IndiaPostChargeEstimate extends SingleCourierEstimate {
  totalIndiaPostCharge: number;
}

export function calculateSingleCourierCharge(
  code: CourierCode,
  opts: {
    weight_grams?: number | null;
    length_cm?: number | null;
    breadth_cm?: number | null;
    height_cm?: number | null;
    cod_mode?: string | null;
    cod_value?: number | null;
    total_amount?: number | null;
    sender_pincode?: string | number | null;
    receiver_pincode?: string | number | null;
  }
): SingleCourierEstimate {
  const actualWeightGrams = Math.max(Number(opts.weight_grams) || 500, 0);
  const lengthCm = Math.max(Number(opts.length_cm) || 0, 0);
  const breadthCm = Math.max(Number(opts.breadth_cm) || 0, 0);
  const heightCm = Math.max(Number(opts.height_cm) || 0, 0);

  // Volumetric weight (grams) = (L * B * H in cm3) / 5
  const volumetricWeightGrams = (lengthCm * breadthCm * heightCm) > 0
    ? Math.round((lengthCm * breadthCm * heightCm) / 5)
    : 0;

  // Billable weight = max(Actual Weight, Volumetric Weight)
  const billableWeightGrams = Math.max(actualWeightGrams, volumetricWeightGrams);

  // Determine Distance Zone based on Pincodes
  const { zone, label: zoneLabel } = detectSpeedPostZone(
    opts.sender_pincode,
    opts.receiver_pincode
  );

  const isCod = String(opts.cod_mode || "").toUpperCase() === "COD";
  const codVal = Number(opts.cod_value) || Number(opts.total_amount) || 0;

  const extraSlabs = Math.max(0, Math.ceil((billableWeightGrams - 500) / 500));

  let basePostage = 0;
  let docketFee = 0;
  let fuelSurcharge = 0;
  let codFee = 0;
  let name = "";
  let badgeBg = "";
  let badgeText = "";
  let logoEmoji = "";

  if (code === "INDIA_POST") {
    name = "India Post Speed Post";
    badgeBg = "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300";
    badgeText = "India Post";
    logoEmoji = "";

    if (zone === "LOCAL") {
      if (billableWeightGrams <= 50) basePostage = 15;
      else if (billableWeightGrams <= 200) basePostage = 25;
      else if (billableWeightGrams <= 500) basePostage = 30;
      else basePostage = 30 + extraSlabs * 10;
    } else if (zone === "SAME_STATE") {
      if (billableWeightGrams <= 50) basePostage = 35;
      else if (billableWeightGrams <= 200) basePostage = 35;
      else if (billableWeightGrams <= 500) basePostage = 40;
      else basePostage = 40 + extraSlabs * 15;
    } else if (zone === "REMOTE") {
      if (billableWeightGrams <= 50) basePostage = 35;
      else if (billableWeightGrams <= 200) basePostage = 70;
      else if (billableWeightGrams <= 500) basePostage = 90;
      else basePostage = 90 + extraSlabs * 50;
    } else {
      // NATIONAL
      if (billableWeightGrams <= 50) basePostage = 35;
      else if (billableWeightGrams <= 200) basePostage = 40;
      else if (billableWeightGrams <= 500) basePostage = 50;
      else basePostage = 50 + extraSlabs * 35;
    }

    if (isCod && codVal > 0) {
      codFee = codVal <= 5000 ? 50 : 100;
    }
  } else if (code === "DELHIVERY") {
    name = "Delhivery Surface / Express";
    badgeBg = "bg-red-500/10 border-red-500/30 text-red-800 dark:text-red-300";
    badgeText = "Delhivery";
    logoEmoji = "";

    docketFee = 15;
    if (zone === "LOCAL") basePostage = 35 + extraSlabs * 25;
    else if (zone === "SAME_STATE") basePostage = 45 + extraSlabs * 30;
    else if (zone === "REMOTE") basePostage = 85 + extraSlabs * 55;
    else basePostage = 60 + extraSlabs * 40;

    if (isCod && codVal > 0) {
      codFee = Math.max(40, Math.round(codVal * 0.02 * 100) / 100);
    }
  } else if (code === "DTDC") {
    name = "DTDC Express / Premium";
    badgeBg = "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300";
    badgeText = "DTDC";
    logoEmoji = "";

    docketFee = 25;
    if (zone === "LOCAL") basePostage = 40 + extraSlabs * 25;
    else if (zone === "SAME_STATE") basePostage = 50 + extraSlabs * 35;
    else if (zone === "REMOTE") basePostage = 95 + extraSlabs * 60;
    else basePostage = 70 + extraSlabs * 45;

    if (isCod && codVal > 0) {
      codFee = Math.max(50, Math.round(codVal * 0.025 * 100) / 100);
    }
  } else {
    // BLUEDART
    name = "BlueDart Express Air / Surface";
    badgeBg = "bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-300";
    badgeText = "BlueDart";
    logoEmoji = "";

    docketFee = 30;
    if (zone === "LOCAL") basePostage = 55 + extraSlabs * 35;
    else if (zone === "SAME_STATE") basePostage = 75 + extraSlabs * 45;
    else if (zone === "REMOTE") basePostage = 130 + extraSlabs * 85;
    else basePostage = 95 + extraSlabs * 65;

    fuelSurcharge = Math.round(basePostage * 0.12 * 100) / 100;

    if (isCod && codVal > 0) {
      codFee = Math.max(60, Math.round(codVal * 0.025 * 100) / 100);
    }
  }

  const subtotal = basePostage + docketFee + fuelSurcharge + codFee;
  const gstAmount = Math.round(subtotal * 0.18 * 100) / 100;
  const totalCharge = Math.round((subtotal + gstAmount) * 100) / 100;

  return {
    code,
    name,
    badgeBg,
    badgeText,
    logoEmoji,
    actualWeightGrams,
    lengthCm,
    breadthCm,
    heightCm,
    volumetricWeightGrams,
    billableWeightGrams,
    zone,
    zoneLabel,
    basePostage,
    docketFee,
    fuelSurcharge,
    codFee,
    gstAmount,
    totalCharge,
  };
}

export function calculateAllCourierCharges(opts: {
  weight_grams?: number | null;
  length_cm?: number | null;
  breadth_cm?: number | null;
  height_cm?: number | null;
  cod_mode?: string | null;
  cod_value?: number | null;
  total_amount?: number | null;
  sender_pincode?: string | number | null;
  receiver_pincode?: string | number | null;
}): MultiCourierEstimate {
  const indiaPost = calculateSingleCourierCharge("INDIA_POST", opts);
  const delhivery = calculateSingleCourierCharge("DELHIVERY", opts);
  const dtdc = calculateSingleCourierCharge("DTDC", opts);
  const blueDart = calculateSingleCourierCharge("BLUEDART", opts);

  const estimates: Record<CourierCode, SingleCourierEstimate> = {
    INDIA_POST: indiaPost,
    DELHIVERY: delhivery,
    DTDC: dtdc,
    BLUEDART: blueDart,
  };

  const all = [indiaPost, delhivery, dtdc, blueDart];
  const sorted = [...all].sort((a, b) => a.totalCharge - b.totalCharge);
  const cheapest = sorted[0];

  all.forEach((c) => {
    c.isCheapest = c.code === cheapest.code;
  });

  return {
    actualWeightGrams: indiaPost.actualWeightGrams,
    lengthCm: indiaPost.lengthCm,
    breadthCm: indiaPost.breadthCm,
    heightCm: indiaPost.heightCm,
    volumetricWeightGrams: indiaPost.volumetricWeightGrams,
    billableWeightGrams: indiaPost.billableWeightGrams,
    zone: indiaPost.zone,
    zoneLabel: indiaPost.zoneLabel,
    estimates,
    cheapestCourier: cheapest,
  };
}

export function calculateIndiaPostCharges(opts: {
  weight_grams?: number | null;
  length_cm?: number | null;
  breadth_cm?: number | null;
  height_cm?: number | null;
  cod_mode?: string | null;
  cod_value?: number | null;
  total_amount?: number | null;
  sender_pincode?: string | number | null;
  receiver_pincode?: string | number | null;
}): IndiaPostChargeEstimate {
  const single = calculateSingleCourierCharge("INDIA_POST", opts);
  return {
    ...single,
    totalIndiaPostCharge: single.totalCharge,
  };
}


