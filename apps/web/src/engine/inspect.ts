/**
 * Read-only presentation data for the match inspector. It only re-describes what the engine already computed (inventory,
 * dependencies, the schedule); it never changes a rule, a calculation or a qualification outcome.
 */
import type { Inventory, Match, Schedule, Slot, TournamentConfig } from "@engine";

export type MatchKind = "prelim" | "semi" | "medal";

export interface Neighbor {
  matchId: string;
  name: string;
  courtName: string;
  day: string;
  start: number;
  end: number;
  /** Minutes between the two matches (slot end to next start), or null when the day differs. */
  gapMinutes: number | null;
}

export interface SlotDetail {
  text: string;
  teamId: string | null;
  players: string[];
}

export interface RecoveryDetail {
  team: string;
  restRequiredMinutes: number;
  previous: Neighbor | null;
  next: Neighbor | null;
}

export interface MatchDetail {
  id: string;
  label: string;
  divisionId: string;
  divisionName: string;
  categoryName: string;
  skillLevel: string | null;
  kind: MatchKind;
  kindLabel: string;
  stageLabel: string;
  groupLabel: string | null;
  roundLabel: string;
  durationMinutes: number;
  provisional: boolean;
  slots: [SlotDetail, SlotDetail];
  before: Neighbor[];
  after: Neighbor[];
  recovery: RecoveryDetail[];
}

const ordinal = (n: number) => {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
};

/** Ids of final and third-place matches, per the engine's knockout structures. */
export function medalMatchIds(inventory: Inventory): Set<string> {
  const ids = new Set<string>();
  for (const d of inventory.divisions)
    for (const s of d.stages)
      if (s.kind === "knockout") {
        ids.add(s.finalMatchId);
        if (s.thirdPlaceMatchId) ids.add(s.thirdPlaceMatchId);
      }
  return ids;
}

export function kindOf(match: Match, medals: ReadonlySet<string>): MatchKind {
  if (match.phase === "group") return "prelim";
  return medals.has(match.id) ? "medal" : "semi";
}

export function inspect(inventory: Inventory, config: TournamentConfig, schedule: Schedule, matchId: string): MatchDetail | null {
  const match = inventory.matchById.get(matchId);
  if (!match) return null;
  const division = config.divisions.find((d) => d.id === match.divisionId);
  const category = config.categories.find((c) => c.id === division?.categoryId);
  const kind = kindOf(match, medalMatchIds(inventory));
  const placed = new Map(schedule.assignments.map((a) => [a.matchId, a]));
  const courtName = (id: string) => config.courts.find((c) => c.id === id)?.name ?? id;
  const players = new Map(config.players.map((p) => [p.id, p.name]));
  const dayIndex = (day: string) => Math.max(0, config.days.indexOf(day));
  const nameOf = (m: Match | undefined) => (m ? `${m.divisionId} ${m.label}` : "an earlier match");

  const slotText = (slot: Slot): SlotDetail => {
    switch (slot.type) {
      case "team": {
        const team = inventory.teamById.get(slot.teamId);
        return { text: team?.name ?? slot.teamId, teamId: slot.teamId, players: (team?.playerIds ?? []).map((p) => players.get(p) ?? p) };
      }
      case "winner":
        return { text: `Winner of ${nameOf(inventory.matchById.get(slot.matchId))}`, teamId: null, players: [] };
      case "loser":
        return { text: `Loser of ${nameOf(inventory.matchById.get(slot.matchId))}`, teamId: null, players: [] };
      case "group_rank":
        return { text: `${ordinal(slot.rank)} place, Group ${slot.groupId}`, teamId: null, players: [] };
      case "wildcard":
        return { text: `Wildcard: best ${ordinal(slot.rank)}-placed team (#${slot.index})`, teamId: null, players: [] };
    }
  };

  const here = placed.get(matchId);
  const hereEnd = here ? here.start + match.durationMinutes : 0;
  const hereAbs = here ? dayIndex(here.day) * 1440 + here.start : 0;
  const rest = (m: Match) => Math.max(division?.minRestMinutes ?? config.rules.minRestMinutes, config.divisions.find((d) => d.id === m.divisionId)?.minRestMinutes ?? config.rules.minRestMinutes);

  const neighbor = (m: Match): Neighbor | null => {
    const a = placed.get(m.id);
    if (!a) return null;
    const end = a.start + m.durationMinutes;
    const sameDay = !!here && a.day === here.day;
    const gap = !here || !sameDay ? null : a.start >= hereEnd ? a.start - hereEnd : here.start >= end ? here.start - end : null;
    return { matchId: m.id, name: nameOf(m), courtName: courtName(a.courtId), day: a.day, start: a.start, end, gapMinutes: gap };
  };

  const recovery: RecoveryDetail[] = [];
  if (here) {
    for (const slot of match.slots) {
      if (slot.type !== "team") continue;
      const others = inventory.matches
        .filter((m) => m.id !== matchId && placed.has(m.id) && m.slots.some((s) => s.type === "team" && s.teamId === slot.teamId))
        .map((m) => {
          const a = placed.get(m.id)!;
          const abs = dayIndex(a.day) * 1440 + a.start;
          return { m, abs, endAbs: abs + m.durationMinutes };
        });
      const prev = others.filter((o) => o.endAbs <= hereAbs).sort((x, y) => y.endAbs - x.endAbs)[0];
      const next = others.filter((o) => o.abs >= hereAbs + match.durationMinutes).sort((x, y) => x.abs - y.abs)[0];
      recovery.push({
        team: inventory.teamById.get(slot.teamId)?.name ?? slot.teamId,
        restRequiredMinutes: Math.max(...[match, ...(prev ? [prev.m] : []), ...(next ? [next.m] : [])].map(rest)),
        previous: prev ? neighbor(prev.m) : null,
        next: next ? neighbor(next.m) : null,
      });
    }
  }

  const feeders = match.dependencies.map((d) => inventory.matchById.get(d.matchId)).filter((m): m is Match => !!m);
  const dependents = inventory.matches.filter((m) => m.dependencies.some((d) => d.matchId === matchId));
  const group = match.groupId && match.groupId !== "RR" ? match.groupId : null;
  const kindLabel =
    kind === "prelim" ? "Preliminary" : kind === "medal" ? (match.thirdPlace ? "Bronze medal match" : "Gold medal match") : /semi/i.test(match.roundLabel) ? "Semifinal" : /quarter/i.test(match.roundLabel) ? "Quarterfinal" : "Knockout";

  return {
    id: match.id,
    label: match.label,
    divisionId: match.divisionId,
    divisionName: division?.name ?? match.divisionId,
    categoryName: category?.name ?? "",
    skillLevel: division?.skillLevel ?? null,
    kind,
    kindLabel,
    stageLabel: match.phase === "group" ? (group ? "Pool play" : "Round robin") : "Playoffs",
    groupLabel: group,
    roundLabel: match.roundLabel,
    durationMinutes: match.durationMinutes,
    provisional: match.phase === "knockout" && match.slots.some((s) => s.type !== "team"),
    slots: [slotText(match.slots[0]), slotText(match.slots[1])],
    before: feeders.map(neighbor).filter((n): n is Neighbor => !!n),
    after: dependents.map(neighbor).filter((n): n is Neighbor => !!n),
    recovery,
  };
}

/** Compact side description for dense views: a team name or a short qualification placeholder. */
export function slotShort(inventory: Inventory, slot: Slot): string {
  switch (slot.type) {
    case "team":
      return inventory.teamById.get(slot.teamId)?.name ?? slot.teamId;
    case "winner":
      return `W ${inventory.matchById.get(slot.matchId)?.label ?? ""}`;
    case "loser":
      return `L ${inventory.matchById.get(slot.matchId)?.label ?? ""}`;
    case "group_rank":
      return `${ordinal(slot.rank)} ${slot.groupId}`;
    case "wildcard":
      return `Wildcard ${slot.index}`;
  }
}
