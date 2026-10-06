export function slaTone(status: string): "ok" | "warn" | "critical" {
  if (status === "BREACHED") return "critical";
  if (status === "APPROACHING") return "warn";
  return "ok";
}
