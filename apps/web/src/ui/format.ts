import { clock } from "../domain/spec.js";

export { clock };

export const hours = (minutes: number): string => (minutes < 90 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`);

export const dayLabel = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const savedAgo = (at: number | null): string => {
  if (!at) return "";
  const seconds = Math.round((Date.now() - at) / 1000);
  return seconds < 5 ? "just now" : seconds < 90 ? `${seconds}s ago` : `${Math.round(seconds / 60)} min ago`;
};
