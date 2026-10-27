import type { Court, Division, Player, StageConfig, Team, TimeWindow, TournamentConfig } from "@engine";
import type { DivisionSpec, EventSpec } from "./spec.js";

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Stable id for an event; derived from the name so a rename does not silently break saved schedules. */
export const eventId = (spec: EventSpec) => `event-${slug(spec.name) || "untitled"}`;

interface ParsedTeam {
  name: string;
  playerNames: string[];
}

export function parseTeamLine(line: string, doubles: boolean, fallbackKey: string): ParsedTeam {
  const trimmed = line.trim();
  const parts = trimmed
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  const need = doubles ? 2 : 1;
  if (parts.length >= need) return { name: trimmed, playerNames: parts.slice(0, need) };
  // A bare team name: placeholder players are private to this team so they never create cross-division conflicts.
  return { name: trimmed, playerNames: Array.from({ length: need }, (_, i) => `${trimmed || fallbackKey} (player ${i + 1})`) };
}

function stagesFor(d: DivisionSpec): StageConfig[] {
  const f = d.format;
  if (f.kind === "round_robin") return [{ id: "rr", kind: "round_robin", legs: f.doubleRoundRobin ? 2 : 1 }];
  if (f.kind === "knockout") return [{ id: "ko", kind: "single_elimination", source: { type: "teams" }, thirdPlaceMatch: f.thirdPlace }];
  return [
    { id: "pool", kind: "groups", groupCount: f.groupCount, legs: 1, allocation: "snake" },
    {
      id: "ko",
      kind: "single_elimination",
      source: {
        type: "qualifiers",
        fromStageId: "pool",
        perGroup: f.perPool,
        ...(f.wildcard > 0 ? { wildcards: { count: f.wildcard, rank: f.perPool + 1 } } : {}),
      },
      thirdPlaceMatch: f.thirdPlace,
    },
  ];
}

/**
 * Expands the wizard's EventSpec into the engine's TournamentConfig. Players with the same name are one person,
 * across divisions, so a player entered in two divisions is protected from overlapping matches.
 */
export function buildConfig(spec: EventSpec): TournamentConfig {
  const players = new Map<string, Player>();
  const person = (name: string, scope: string, shared: boolean) => {
    const id = shared ? `p-${slug(name)}` : `p-${scope}-${slug(name)}`;
    if (!players.has(id)) players.set(id, { id, name });
    return id;
  };

  const categories = new Map(spec.categories.map((c) => [c.id, c]));
  const divisions: Division[] = spec.divisions.map((d) => {
    const doubles = categories.get(d.categoryId)?.discipline !== "singles";
    const teams: Team[] = d.teams
      .filter((line) => line.trim() !== "")
      .map((line, i) => {
        const parsed = parseTeamLine(line, doubles, `${d.id}-${i + 1}`);
        const named = line.includes("/");
        return {
          id: `${d.id}-T${i + 1}`,
          name: parsed.name,
          playerIds: parsed.playerNames.map((n) => person(n, d.id, named)),
          seed: i + 1,
        };
      });
    const windows: TimeWindow[] | undefined = d.window ? spec.days.map((day) => ({ day, start: d.window!.start, end: d.window!.end })) : undefined;
    return {
      id: d.id,
      name: d.name,
      categoryId: d.categoryId,
      ...(d.skillLevel ? { skillLevel: d.skillLevel } : {}),
      teams,
      stages: stagesFor(d),
      matchDurationMinutes: d.matchMinutes,
      ...(d.medalMinutes !== null && d.format.kind !== "round_robin" ? { medalMatchDurationMinutes: d.medalMinutes } : {}),
      scoring: { bestOf: d.bestOf },
      standings: { tiebreakers: d.tiebreakers },
      ...(d.recoveryMinutes !== null ? { minRestMinutes: d.recoveryMinutes } : {}),
      ...(windows ? { playWindows: windows } : {}),
    };
  });

  const courts: Court[] = spec.courts.map((c) => ({
    id: c.id,
    name: c.name,
    ...(c.tags.length ? { tags: c.tags } : {}),
    availability: spec.days.flatMap((day): TimeWindow[] => {
      const o = c.overrides[day];
      if (o === null) return [];
      const w = o ?? spec.dayWindow;
      return [{ day, start: w.start, end: w.end }];
    }),
  }));

  return {
    id: eventId(spec),
    name: spec.name,
    days: [...spec.days].sort(),
    courts,
    players: [...players.values()],
    categories: spec.categories.map((c) => ({ ...c })),
    divisions,
    rules: {
      courtTurnoverMinutes: spec.courtTurnoverMinutes,
      minRestMinutes: spec.recoveryMinutes,
      ...(spec.maxMatchesPerPlayerPerDay !== null ? { maxMatchesPerPlayerPerDay: spec.maxMatchesPerPlayerPerDay } : {}),
    },
  };
}
