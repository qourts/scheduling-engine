import { isIsoDate, MINUTES_PER_DAY } from "../util/time.js";
import type { Division, StageConfig, TimeWindow, TournamentConfig } from "./types.js";

export type IssueSeverity = "error" | "warning";

export interface ConfigIssue {
  severity: IssueSeverity;
  code: string;
  /** JSON-path-like location, e.g. "divisions[2].teams[0].playerIds". */
  path: string;
  message: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  issues: ConfigIssue[];
}

export class InvalidConfigError extends Error {
  constructor(readonly issues: ConfigIssue[]) {
    super(
      `Invalid tournament configuration:\n` +
        issues
          .filter((i) => i.severity === "error")
          .map((i) => `  [${i.code}] ${i.path}: ${i.message}`)
          .join("\n"),
    );
    this.name = "InvalidConfigError";
  }
}

const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const TIEBREAKERS = new Set(["wins", "head_to_head", "game_difference", "point_difference", "points_for", "seed", "draw"]);

/**
 * Validates a tournament configuration. Pure: never mutates or normalises the input.
 * A configuration is usable when there are no "error" issues; warnings are advisory.
 */
export function validateConfig(config: TournamentConfig): ConfigValidationResult {
  const issues: ConfigIssue[] = [];
  const error = (code: string, path: string, message: string) => issues.push({ severity: "error", code, path, message });
  const warn = (code: string, path: string, message: string) => issues.push({ severity: "warning", code, path, message });

  const checkId = (value: unknown, path: string) => {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
      error("INVALID_ID", path, `IDs must be non-empty and use only letters, digits, "_", "." or "-" (got ${JSON.stringify(value)})`);
    }
  };
  const checkUnique = (ids: string[], path: string, what: string) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) error("DUPLICATE_ID", `${path}[${index}].id`, `Duplicate ${what} id "${id}"`);
      seen.add(id);
    });
  };
  const nonNegativeInt = (value: unknown, path: string, code: string) => {
    if (!Number.isInteger(value) || (value as number) < 0) error(code, path, `Must be a non-negative integer (got ${JSON.stringify(value)})`);
  };
  const positiveInt = (value: unknown, path: string, code: string) => {
    if (!Number.isInteger(value) || (value as number) <= 0) error(code, path, `Must be a positive integer (got ${JSON.stringify(value)})`);
  };

  checkId(config.id, "id");

  // Days
  const daySet = new Set<string>();
  if (!Array.isArray(config.days) || config.days.length === 0) {
    error("NO_DAYS", "days", "At least one tournament day is required");
  } else {
    config.days.forEach((day, i) => {
      if (!isIsoDate(day)) error("INVALID_DATE", `days[${i}]`, `"${day}" is not a valid ISO date (YYYY-MM-DD)`);
      if (daySet.has(day)) error("DUPLICATE_DAY", `days[${i}]`, `Day "${day}" is listed twice`);
      const prev = config.days[i - 1];
      if (prev !== undefined && day <= prev) error("DAYS_NOT_ASCENDING", `days[${i}]`, "Days must be listed in ascending order");
      daySet.add(day);
    });
  }

  const checkWindow = (w: TimeWindow, path: string) => {
    if (!daySet.has(w.day)) error("UNKNOWN_DAY", `${path}.day`, `Day "${w.day}" is not a tournament day`);
    if (!Number.isInteger(w.start) || !Number.isInteger(w.end) || w.start < 0 || w.end > MINUTES_PER_DAY || w.start >= w.end) {
      error("INVALID_WINDOW", path, `Window must satisfy 0 <= start < end <= 1440 with integer minutes (got ${w.start}-${w.end})`);
    }
  };
  const checkNoOverlap = (windows: TimeWindow[], path: string) => {
    const sorted = windows.map((w, i) => ({ w, i })).sort((a, b) => (a.w.day < b.w.day ? -1 : a.w.day > b.w.day ? 1 : a.w.start - b.w.start));
    for (let k = 1; k < sorted.length; k++) {
      const a = sorted[k - 1]!;
      const b = sorted[k]!;
      if (a.w.day === b.w.day && b.w.start < a.w.end) {
        error("OVERLAPPING_WINDOWS", `${path}[${b.i}]`, `Overlaps ${path}[${a.i}]; list each period once`);
      }
    }
  };

  // Rules
  if (!config.rules) {
    error("MISSING_RULES", "rules", "Global rules are required");
  } else {
    nonNegativeInt(config.rules.courtTurnoverMinutes, "rules.courtTurnoverMinutes", "INVALID_TURNOVER");
    nonNegativeInt(config.rules.minRestMinutes, "rules.minRestMinutes", "INVALID_REST");
    if (config.rules.maxMatchesPerPlayerPerDay !== undefined) {
      positiveInt(config.rules.maxMatchesPerPlayerPerDay, "rules.maxMatchesPerPlayerPerDay", "INVALID_CAP");
    }
  }

  // Courts
  const courtIds = new Set<string>();
  if (!Array.isArray(config.courts) || config.courts.length === 0) {
    error("NO_COURTS", "courts", "At least one court is required");
  } else {
    config.courts.forEach((court, i) => {
      checkId(court.id, `courts[${i}].id`);
      courtIds.add(court.id);
      if (!court.availability || court.availability.length === 0) {
        warn("COURT_NEVER_AVAILABLE", `courts[${i}].availability`, `Court "${court.id}" has no availability and cannot host matches`);
      } else {
        court.availability.forEach((w, j) => checkWindow(w, `courts[${i}].availability[${j}]`));
        checkNoOverlap(court.availability, `courts[${i}].availability`);
      }
    });
    checkUnique(config.courts.map((c) => c.id), "courts", "court");
  }

  // Players
  const playerIds = new Set<string>();
  (config.players ?? []).forEach((p, i) => {
    checkId(p.id, `players[${i}].id`);
    playerIds.add(p.id);
  });
  checkUnique((config.players ?? []).map((p) => p.id), "players", "player");

  // Categories
  const categories = new Map((config.categories ?? []).map((c) => [c.id, c]));
  (config.categories ?? []).forEach((c, i) => {
    checkId(c.id, `categories[${i}].id`);
    if (c.discipline !== "singles" && c.discipline !== "doubles") {
      error("INVALID_DISCIPLINE", `categories[${i}].discipline`, `Unknown discipline "${String(c.discipline)}"`);
    }
  });
  checkUnique((config.categories ?? []).map((c) => c.id), "categories", "category");

  // Divisions
  const teamIds = new Set<string>();
  const teamOwner = new Map<string, string>();
  const allTeamIdList: string[] = [];
  if (!Array.isArray(config.divisions) || config.divisions.length === 0) {
    error("NO_DIVISIONS", "divisions", "At least one division is required");
  }
  (config.divisions ?? []).forEach((division, d) => {
    const path = `divisions[${d}]`;
    checkId(division.id, `${path}.id`);
    const category = categories.get(division.categoryId);
    if (!category) error("UNKNOWN_CATEGORY", `${path}.categoryId`, `Category "${division.categoryId}" does not exist`);
    const teamSize = category?.discipline === "singles" ? 1 : category?.discipline === "doubles" ? 2 : undefined;

    positiveInt(division.matchDurationMinutes, `${path}.matchDurationMinutes`, "INVALID_DURATION");
    if (division.medalMatchDurationMinutes !== undefined) {
      positiveInt(division.medalMatchDurationMinutes, `${path}.medalMatchDurationMinutes`, "INVALID_DURATION");
    }
    if (division.minRestMinutes !== undefined) nonNegativeInt(division.minRestMinutes, `${path}.minRestMinutes`, "INVALID_REST");
    if (![1, 3, 5].includes(division.scoring?.bestOf as number)) {
      error("INVALID_SCORING", `${path}.scoring.bestOf`, "bestOf must be 1, 3 or 5");
    }
    validateTiebreakers(division, path, error);

    (division.playWindows ?? []).forEach((w, j) => checkWindow(w, `${path}.playWindows[${j}]`));
    if (division.playWindows) checkNoOverlap(division.playWindows, `${path}.playWindows`);
    if (division.playWindows && division.playWindows.length === 0) {
      error("EMPTY_PLAY_WINDOWS", `${path}.playWindows`, "playWindows is empty; omit it to allow any time");
    }
    (division.eligibleCourtIds ?? []).forEach((id, j) => {
      if (!courtIds.has(id)) error("UNKNOWN_COURT", `${path}.eligibleCourtIds[${j}]`, `Court "${id}" does not exist`);
    });
    if (division.eligibleCourtIds && division.eligibleCourtIds.length === 0) {
      error("NO_ELIGIBLE_COURTS", `${path}.eligibleCourtIds`, "eligibleCourtIds is empty; omit it to allow every court");
    }

    // Teams
    const teams = division.teams ?? [];
    if (teams.length < 2) error("TOO_FEW_TEAMS", `${path}.teams`, `A division needs at least 2 teams (has ${teams.length})`);
    const playersInDivision = new Map<string, string>();
    const seeds = new Set<number>();
    teams.forEach((team, t) => {
      const tpath = `${path}.teams[${t}]`;
      checkId(team.id, `${tpath}.id`);
      allTeamIdList.push(team.id);
      if (teamIds.has(team.id)) {
        error("DUPLICATE_ID", `${tpath}.id`, `Team id "${team.id}" is already used in division "${teamOwner.get(team.id)}"; team ids must be unique across the tournament`);
      }
      teamIds.add(team.id);
      teamOwner.set(team.id, division.id);
      if (teamSize !== undefined && team.playerIds.length !== teamSize) {
        error("WRONG_TEAM_SIZE", `${tpath}.playerIds`, `${category?.discipline} teams need exactly ${teamSize} player(s) (has ${team.playerIds.length})`);
      }
      if (new Set(team.playerIds).size !== team.playerIds.length) {
        error("DUPLICATE_PLAYER_IN_TEAM", `${tpath}.playerIds`, "A player is listed twice in the same team");
      }
      team.playerIds.forEach((pid, k) => {
        if (!playerIds.has(pid)) error("UNKNOWN_PLAYER", `${tpath}.playerIds[${k}]`, `Player "${pid}" does not exist`);
        const other = playersInDivision.get(pid);
        if (other !== undefined && other !== team.id) {
          error("PLAYER_IN_TWO_TEAMS", `${tpath}.playerIds[${k}]`, `Player "${pid}" is also on team "${other}" in this division`);
        }
        playersInDivision.set(pid, team.id);
      });
      if (team.seed !== undefined) {
        if (!Number.isInteger(team.seed) || team.seed < 1) error("INVALID_SEED", `${tpath}.seed`, "Seeds must be positive integers");
        if (seeds.has(team.seed)) error("DUPLICATE_SEED", `${tpath}.seed`, `Seed ${team.seed} is used twice`);
        seeds.add(team.seed);
      }
    });

    validateStages(division, path, error, warn);
  });

  // Restrictions
  (config.restrictions ?? []).forEach((r, i) => {
    const path = `restrictions[${i}]`;
    checkId(r.id, `${path}.id`);
    if (r.kind !== "unavailable") error("UNKNOWN_RESTRICTION", `${path}.kind`, `Unknown restriction kind "${String(r.kind)}"`);
    if (r.subject.type === "player" && !playerIds.has(r.subject.id)) {
      error("UNKNOWN_PLAYER", `${path}.subject.id`, `Player "${r.subject.id}" does not exist`);
    }
    if (r.subject.type === "team" && !teamIds.has(r.subject.id)) {
      error("UNKNOWN_TEAM", `${path}.subject.id`, `Team "${r.subject.id}" does not exist`);
    }
    checkWindow(r.window, `${path}.window`);
  });
  checkUnique((config.restrictions ?? []).map((r) => r.id), "restrictions", "restriction");

  return { valid: !issues.some((i) => i.severity === "error"), issues };
}

export function assertValidConfig(config: TournamentConfig): void {
  const result = validateConfig(config);
  if (!result.valid) throw new InvalidConfigError(result.issues);
}

function validateTiebreakers(division: Division, path: string, error: (c: string, p: string, m: string) => void) {
  const list = division.standings?.tiebreakers;
  if (!Array.isArray(list) || list.length === 0) {
    error("MISSING_TIEBREAKERS", `${path}.standings.tiebreakers`, "An ordered tiebreaker list is required");
    return;
  }
  list.forEach((t, i) => {
    if (!TIEBREAKERS.has(t)) error("UNKNOWN_TIEBREAKER", `${path}.standings.tiebreakers[${i}]`, `Unknown tiebreaker "${t}"`);
  });
  if (new Set(list).size !== list.length) error("DUPLICATE_TIEBREAKER", `${path}.standings.tiebreakers`, "Each tiebreaker may appear once");
  if (list[list.length - 1] !== "draw") {
    error("TIEBREAKERS_NOT_TOTAL", `${path}.standings.tiebreakers`, 'The last tiebreaker must be "draw" so every tie is resolved');
  }
}

function validateStages(
  division: Division,
  path: string,
  error: (c: string, p: string, m: string) => void,
  warn: (c: string, p: string, m: string) => void,
) {
  const stages: StageConfig[] = division.stages ?? [];
  const teamCount = (division.teams ?? []).length;
  if (stages.length === 0 || stages.length > 2) {
    error("INVALID_STAGE_COUNT", `${path}.stages`, "A division has one stage, or a group/round-robin stage followed by a knockout stage");
    return;
  }
  const stageIds = new Set<string>();
  stages.forEach((stage, s) => {
    const spath = `${path}.stages[${s}]`;
    if (typeof stage.id !== "string" || !ID_PATTERN.test(stage.id)) error("INVALID_ID", `${spath}.id`, "Invalid stage id");
    if (stageIds.has(stage.id)) error("DUPLICATE_ID", `${spath}.id`, `Duplicate stage id "${stage.id}"`);
    stageIds.add(stage.id);

    switch (stage.kind) {
      case "round_robin":
        if (stage.legs !== 1 && stage.legs !== 2) error("INVALID_LEGS", `${spath}.legs`, "legs must be 1 or 2");
        if (s !== 0) error("INVALID_STAGE_ORDER", spath, "A round-robin stage must be the first stage");
        break;
      case "groups": {
        if (stage.legs !== 1 && stage.legs !== 2) error("INVALID_LEGS", `${spath}.legs`, "legs must be 1 or 2");
        if (stage.allocation !== "snake" && stage.allocation !== "sequential") {
          error("INVALID_ALLOCATION", `${spath}.allocation`, 'allocation must be "snake" or "sequential"');
        }
        if (s !== 0) error("INVALID_STAGE_ORDER", spath, "A group stage must be the first stage");
        if (!Number.isInteger(stage.groupCount) || stage.groupCount < 1) {
          error("INVALID_GROUP_COUNT", `${spath}.groupCount`, "groupCount must be a positive integer");
        } else if (Math.floor(teamCount / stage.groupCount) < 2) {
          error("GROUPS_TOO_SMALL", `${spath}.groupCount`, `${teamCount} teams cannot fill ${stage.groupCount} groups of at least 2`);
        } else if (Math.floor(teamCount / stage.groupCount) < 3) {
          warn("SMALL_GROUPS", `${spath}.groupCount`, "Some groups have only 2 teams, so each team plays a single group match");
        }
        break;
      }
      case "single_elimination": {
        if (typeof stage.thirdPlaceMatch !== "boolean") error("INVALID_THIRD_PLACE", `${spath}.thirdPlaceMatch`, "thirdPlaceMatch must be true or false");
        if (stage.source?.type === "teams") {
          if (s !== 0) error("INVALID_STAGE_ORDER", `${spath}.source`, 'A knockout seeded from "teams" must be the first stage');
          if (stage.thirdPlaceMatch && teamCount < 4) error("THIRD_PLACE_NEEDS_SEMIFINALS", `${spath}.thirdPlaceMatch`, "A third-place match needs at least 4 entrants");
        } else if (stage.source?.type === "qualifiers") {
          const previous = stages[s - 1];
          if (s !== 1 || !previous || previous.id !== stage.source.fromStageId) {
            error("INVALID_QUALIFICATION_SOURCE", `${spath}.source.fromStageId`, "Qualifiers must come from the immediately preceding stage");
            break;
          }
          if (previous.kind === "single_elimination") {
            error("INVALID_QUALIFICATION_SOURCE", `${spath}.source.fromStageId`, "Qualifiers must come from a group or round-robin stage");
            break;
          }
          const groupCount = previous.kind === "groups" ? previous.groupCount : 1;
          const smallestGroup = Math.floor(teamCount / Math.max(1, groupCount));
          const perGroup = stage.source.perGroup;
          if (!Number.isInteger(perGroup) || perGroup < 1) {
            error("INVALID_QUALIFIERS", `${spath}.source.perGroup`, "perGroup must be a positive integer");
          } else if (perGroup > smallestGroup) {
            error("TOO_MANY_QUALIFIERS", `${spath}.source.perGroup`, `perGroup (${perGroup}) exceeds the smallest group size (${smallestGroup})`);
          } else if (perGroup * groupCount < 2) {
            error("TOO_FEW_QUALIFIERS", `${spath}.source.perGroup`, "The knockout needs at least 2 qualifiers");
          } else if (stage.thirdPlaceMatch && perGroup * groupCount < 4) {
            error("THIRD_PLACE_NEEDS_SEMIFINALS", `${spath}.thirdPlaceMatch`, "A third-place match needs at least 4 entrants");
          } else if (perGroup === smallestGroup) {
            warn("ALL_TEAMS_QUALIFY", `${spath}.source.perGroup`, "Every team of the smallest group qualifies, so its group matches only decide seeding");
          }
        } else {
          error("INVALID_KNOCKOUT_SOURCE", `${spath}.source`, 'source.type must be "teams" or "qualifiers"');
        }
        break;
      }
      default:
        error("UNKNOWN_STAGE_KIND", `${spath}.kind`, `Unknown stage kind "${String((stage as { kind: unknown }).kind)}"`);
    }
  });
  const second = stages[1];
  if (second && second.kind !== "single_elimination") {
    error("INVALID_STAGE_ORDER", `${path}.stages[1]`, "The second stage must be a single-elimination knockout");
  }
  if (second && second.kind === "single_elimination" && second.source.type !== "qualifiers") {
    error("INVALID_KNOCKOUT_SOURCE", `${path}.stages[1].source`, 'A second-stage knockout must take "qualifiers" from the first stage');
  }
}
