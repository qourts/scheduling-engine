import type { Schedule, TournamentConfig } from "@engine";
import type { MatchInfo } from "../engine/core.js";
import { PROJECT_SCHEMA_VERSION, type Project } from "../domain/project.js";
import { clock } from "../domain/spec.js";

export const EXPORT_FORMAT = "qourts-smart-scheduler-project";

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  project: Project;
}

export function exportProjectJson(project: Project): string {
  const envelope: ExportEnvelope = { format: EXPORT_FORMAT, version: PROJECT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), project };
  return JSON.stringify(envelope, null, 2);
}

export type ImportResult = { ok: true; project: Project } | { ok: false; error: string };

/** Validates the shape of an exported file before it can touch the app. The engine re-validates everything on use. */
export function importProjectJson(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  if (typeof data !== "object" || data === null) return { ok: false, error: "This file is not a Qourts Smart Scheduler export." };
  const env = data as Partial<ExportEnvelope>;
  if (env.format !== EXPORT_FORMAT) return { ok: false, error: "This file is not a Qourts Smart Scheduler export." };
  if (typeof env.version !== "number" || env.version > PROJECT_SCHEMA_VERSION) return { ok: false, error: `This export was made by a newer version (format ${String(env.version)}). Update the app to open it.` };
  const p = env.project as Partial<Project> | undefined;
  if (!p || typeof p.id !== "string" || !p.spec || !Array.isArray(p.spec.divisions) || !Array.isArray(p.spec.courts) || !Array.isArray(p.rules) || !Array.isArray(p.revisions)) {
    return { ok: false, error: "The export is incomplete or damaged." };
  }
  return { ok: true, project: p as Project };
}

/** Guards against spreadsheet formula injection from user-entered names. */
function cell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const row = (values: (string | number)[]) => values.map(cell).join(",");

/** One line per match, in time order. */
export function scheduleToCsv(config: TournamentConfig, matches: MatchInfo[], schedule: Schedule, locks: string[]): string {
  const info = new Map(matches.map((m) => [m.id, m]));
  const court = new Map(config.courts.map((c) => [c.id, c.name]));
  const division = new Map(config.divisions.map((d) => [d.id, d.name]));
  const lines = [row(["Day", "Start", "End", "Court", "Division", "Match", "Round", "Phase", "Locked", "Match id"])];
  const sorted = [...schedule.assignments].sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start || a.courtId.localeCompare(b.courtId));
  for (const a of sorted) {
    const m = info.get(a.matchId);
    const dur = m?.durationMinutes ?? 0;
    lines.push(row([a.day, clock(a.start), clock(a.start + dur), court.get(a.courtId) ?? a.courtId, m ? (division.get(m.divisionId) ?? m.divisionId) : "", m?.label ?? "", m?.roundLabel ?? "", m?.phase ?? "", locks.includes(a.matchId) ? "yes" : "", a.matchId]));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Courts down the side, start times across: one grid per day. */
export function matrixToCsv(config: TournamentConfig, matches: MatchInfo[], schedule: Schedule): string {
  const info = new Map(matches.map((m) => [m.id, m]));
  const out: string[] = [];
  for (const day of config.days) {
    const todays = schedule.assignments.filter((a) => a.day === day);
    const starts = [...new Set(todays.map((a) => a.start))].sort((a, b) => a - b);
    out.push(row([day, ...starts.map(clock)]));
    for (const c of config.courts) {
      out.push(row([c.name, ...starts.map((s) => {
        const a = todays.find((x) => x.courtId === c.id && x.start === s);
        const m = a ? info.get(a.matchId) : undefined;
        return m ? `${m.divisionId} ${m.label}` : "";
      })]));
    }
    out.push("");
  }
  return out.join("\r\n");
}

export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFilename = (name: string) => name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "schedule";
