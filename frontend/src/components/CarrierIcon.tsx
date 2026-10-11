import React from "react";
import {
  IconPackage,
  IconPlane,
  IconStore,
  IconTruck,
} from "./icons";

/* Carrier identity used to be emoji in the option labels (🇮🇳 / 🔴 / ✈️ / 📦).
   Emoji render differently per OS and per user settings, and they carry no
   accessible name, so each carrier now maps to one icon from the set. One
   lookup keeps that mapping out of the individual files. */
export type CarrierKey = "INDIA_POST" | "DELHIVERY" | "BLUEDART" | "DTDC" | "MANUAL";

const CARRIER_ICON: Record<CarrierKey, React.FC<{ size?: number; className?: string }>> = {
  INDIA_POST: IconStore,
  DELHIVERY: IconTruck,
  BLUEDART: IconPlane,
  DTDC: IconPackage,
  MANUAL: IconPackage,
};

const CARRIER_TONE: Record<CarrierKey, string> = {
  INDIA_POST: "text-status-success",
  DELHIVERY: "text-status-danger",
  BLUEDART: "text-status-info",
  DTDC: "text-status-warning",
  MANUAL: "text-muted-foreground",
};

export function CarrierIcon({
  code,
  size = 15,
  className,
}: {
  code: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const key = (code ?? "").toUpperCase() as CarrierKey;
  const Icon = CARRIER_ICON[key] ?? IconTruck;
  return <Icon size={size} className={`${CARRIER_TONE[key] ?? "text-muted-foreground"} ${className ?? ""}`} />;
}

/* Drop-in replacement for the old "<emoji> India Post" option labels. */
export const CARRIER_OPTIONS: { value: string; label: string; icon?: React.ReactNode }[] = [
  { value: "INDIA_POST", label: "India Post", icon: <CarrierIcon code="INDIA_POST" /> },
  { value: "DELHIVERY", label: "Delhivery", icon: <CarrierIcon code="DELHIVERY" /> },
  { value: "BLUEDART", label: "Blue Dart", icon: <CarrierIcon code="BLUEDART" /> },
  { value: "DTDC", label: "DTDC", icon: <CarrierIcon code="DTDC" /> },
];