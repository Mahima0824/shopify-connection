export type LastScan = { value: string; at: number } | null;
export const DEBOUNCE_MS = 2500;
export function shouldSuppress(last: LastScan, value: string, now: number): boolean {
  if (!last || last.value !== value) return false;
  return now - last.at < DEBOUNCE_MS;
}
