import { env } from "@/config/env";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Start (00:00 local, as a UTC instant) of the app-local day containing `date`. Local = fixed UTC offset. */
export function startOfLocalDay(date = new Date()): Date {
  const off = env.appUtcOffsetMinutes * MIN;
  return new Date(Math.floor((date.getTime() + off) / DAY) * DAY - off);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

/** Monday 00:00 (app-local) of the week containing `date`. */
export function startOfLocalWeek(date = new Date()): Date {
  const dayStart = startOfLocalDay(date);
  const local = new Date(dayStart.getTime() + env.appUtcOffsetMinutes * MIN);
  const dow = local.getUTCDay() || 7; // Mon=1..Sun=7
  return addDays(dayStart, -(dow - 1));
}

export function startOfLocalMonth(date = new Date()): Date {
  const dayStart = startOfLocalDay(date);
  const local = new Date(dayStart.getTime() + env.appUtcOffsetMinutes * MIN);
  return addDays(dayStart, -(local.getUTCDate() - 1));
}

/** Hour-of-day (0-23), app-local, of an instant. */
export function localHour(d: Date): number {
  return new Date(d.getTime() + env.appUtcOffsetMinutes * MIN).getUTCHours();
}

/** "6h 42m" style label. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** "YYYY-MM-DD" of the app-local calendar date containing `d`. */
export function localDateString(d = new Date()): string {
  return new Date(d.getTime() + env.appUtcOffsetMinutes * MIN).toISOString().slice(0, 10);
}

/** Normalises a Postgres DATE (which node-pg returns as a local-midnight Date) or ISO string to "YYYY-MM-DD". */
export function dateOnly(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}
