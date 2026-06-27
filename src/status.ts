/** No metrics event received within this window => stale/disconnected. */
export const STALE_MS = 30_000;

export function isStale(lastUpdateMs: number, nowMs: number): boolean {
  if (lastUpdateMs <= 0) return false;
  return nowMs - lastUpdateMs > STALE_MS;
}
