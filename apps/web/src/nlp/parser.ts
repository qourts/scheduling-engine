import type { InstructionBody, InstructionVocabulary, MatchRole, MatchSelector } from "@engine";

/**
 * Deterministic interpreter for clearly supported instruction patterns. No network, no model. It proposes; the operator
 * confirms; the engine validates. When the wording does not make mandatory-versus-preferred clear, `strength` is null and
 * the interface must make the operator choose. Nothing is ever defaulted to mandatory.
 */
export interface Interpretation {
  sourceText: string;
  body: InstructionBody;
  /** null = the wording did not say; the operator must choose. */
  strength: "mandatory" | "preference" | null;
  /** True when the rule kind only exists as a preference, so the choice is not offered. */
  preferenceOnly: boolean;
  /** Things the operator should double-check, for example what a phrase like "morning" was taken to mean. */
  notes: string[];
}

export interface ParseOutcome {
  interpretations: Interpretation[];
  unresolved: { text: string; reason: string }[];
}

export const SUPPORTED_PATTERNS: { title: string; examples: string[] }[] = [
  { title: "Play windows for a division or category", examples: ["Advanced Men's Doubles must play in the morning.", "Women's Doubles cannot start before 1 PM.", "Seniors Doubles must finish by 17:00 on day 1."] },
  { title: "Court restrictions", examples: ["High Intermediate only on courts 1-4.", "Reserve Court 10 for medal matches."] },
  { title: "Court unavailable", examples: ["Court 3 is unavailable 12:00-13:30 on day 1."] },
  { title: "Rest between a player's matches", examples: ["At least 20 minutes between matches for High Intermediate."] },
  { title: "Preferences", examples: ["Prefer to keep pool play on one day.", "Try to play Advanced divisions in consecutive blocks."] },
];

const MANDATORY_CUE = /\b(must|cannot|can't|can not|never|has to|have to|required|not allowed|unavailable|closed|blocked|out of service)\b/i;
const PREFERENCE_CUE = /\b(prefer|preferably|ideally|try to|if possible|would like|rather|avoid)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[’`]/g, "'");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Time of day in minutes, or null. Understands 13:00, 1pm, 1:30 pm, noon, midnight. */
export function parseTime(text: string): number | null {
  const t = norm(text).trim();
  if (/\bnoon\b/.test(t)) return 12 * 60;
  if (/\bmidnight\b/.test(t)) return 24 * 60;
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (minute > 59 || hour > 24) return null;
  if (ap === "p" && hour < 12) hour += 12;
  if (ap === "a" && hour === 12) hour = 0;
  if (!ap && !m[2] && hour <= 7) return null; // a bare small number is not a time
  return hour * 60 + minute;
}

const TIME_RE = String.raw`(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|noon|midnight)`;

function dayOf(text: string, vocab: InstructionVocabulary): { day: string | undefined; note?: string } {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)?.[1];
  if (iso) return vocab.days.includes(iso) ? { day: iso } : { day: undefined, note: `${iso} is not one of the tournament days.` };
  const n = /\bday\s*(\d+)\b/i.exec(text)?.[1];
  if (n) {
    const d = vocab.days[Number(n) - 1];
    return d ? { day: d } : { day: undefined, note: `The tournament has no day ${n}.` };
  }
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const w = names.findIndex((x) => new RegExp(`\\b${x}\\b`, "i").test(text));
  if (w >= 0) {
    const d = vocab.days.find((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === w);
    return d ? { day: d } : { day: undefined, note: `No tournament day falls on a ${names[w]}.` };
  }
  return { day: undefined };
}

interface Target {
  selector: MatchSelector;
  label: string;
}

/** Resolves the divisions a sentence is about: a full division name, else skill-level and category words. */
function targetOf(text: string, vocab: InstructionVocabulary): Target | null {
  let rest = norm(text);
  const exact = vocab.divisions.filter((d) => rest.includes(norm(d.name)));
  if (exact.length) return { selector: { divisionIds: exact.map((d) => d.id) }, label: exact.map((d) => d.name).join(", ") };

  const levels = [...new Set(vocab.divisions.map((d) => d.skillLevel).filter((x): x is string => !!x))].sort((a, b) => b.length - a.length);
  const matchedLevels: string[] = [];
  for (const level of levels) {
    const re = new RegExp(`\\b${escapeRe(norm(level))}\\b`);
    if (re.test(rest)) {
      matchedLevels.push(level);
      rest = rest.replace(re, " ");
    }
  }
  const matchedCategories = vocab.categories.filter((c) => {
    const name = norm(c.name);
    const first = name.split(/\s+/)[0] ?? name;
    const variants = new Set([name, first, first.replace(/'s$/, "s"), first.replace(/'s$/, "")]);
    return [...variants].some((v) => v.length > 2 && new RegExp(`\\b${escapeRe(v)}\\b`).test(rest));
  });
  if (!matchedLevels.length && !matchedCategories.length) {
    if (/\b(all|every|everything|each)\b/i.test(text)) return { selector: {}, label: "every match" };
    return null;
  }
  const divisions = vocab.divisions.filter(
    (d) => (!matchedLevels.length || (d.skillLevel !== undefined && matchedLevels.includes(d.skillLevel))) && (!matchedCategories.length || matchedCategories.some((c) => c.id === d.categoryId)),
  );
  if (!divisions.length) return null;
  return { selector: { divisionIds: divisions.map((d) => d.id) }, label: [...matchedLevels, ...matchedCategories.map((c) => c.name)].join(" ") || "selected divisions" };
}

function courtsOf(text: string, vocab: InstructionVocabulary): string[] {
  const out = new Set<string>();
  const t = norm(text);
  const range = /\bcourts?\s*(\d+)\s*(?:-|–|to|through)\s*(\d+)\b/.exec(t);
  // "courts 4,5,6, and 7" and "courts 4, 5 & 6": any run of commas and "and" between numbers.
  const list = /\bcourts?\s*(\d+(?:(?:\s*(?:,|and|&)\s*)+\d+)*)/.exec(t);
  const numbers = new Set<number>();
  if (range) for (let n = Number(range[1]); n <= Number(range[2]); n++) numbers.add(n);
  else if (list?.[1]) for (const n of list[1].match(/\d+/g) ?? []) numbers.add(Number(n));
  for (const c of vocab.courts) {
    const num = /(\d+)\s*$/.exec(c.name)?.[1];
    if (num && numbers.has(Number(num))) out.add(c.id);
    if (c.tags.some((tag) => t.includes(norm(tag)))) out.add(c.id);
  }
  return [...out];
}

function rolesOf(text: string): MatchRole[] | null {
  const t = norm(text);
  if (/\bmedal/.test(t)) return ["medal"];
  const roles: MatchRole[] = [];
  if (/\b(final|finals|gold)\b/.test(t)) roles.push("final");
  if (/\b(bronze|third[- ]place|3rd)\b/.test(t)) roles.push("third_place");
  if (/\b(semi-?finals?|semis?)\b/.test(t)) roles.push("semifinal");
  if (/\bquarter-?finals?\b/.test(t)) roles.push("quarterfinal");
  return roles.length ? roles : null;
}

function strengthFrom(text: string): "mandatory" | "preference" | null {
  if (PREFERENCE_CUE.test(text)) return "preference";
  if (MANDATORY_CUE.test(text)) return "mandatory";
  return null;
}

type Outcome = Interpretation | { reason: string };

function blackout(text: string, t: string, vocab: InstructionVocabulary, day: string | undefined): Outcome {
  const courts = courtsOf(text, vocab);
  const win = new RegExp(`(?:from\\s+)?(${TIME_RE})\\s*(?:-|–|to|until|till)\\s*(${TIME_RE})`, "i").exec(text);
  if (!courts.length) return { reason: "I could not tell which court you mean. Use a court name such as Court 3." };
  if (!win) return { reason: "I could not find the time range. Say it like 12:00-13:30." };
  let start = parseTime(win[1]!);
  const end = parseTime(win[2]!);
  if (start === null || end === null) return { reason: "I could not read that time range." };
  // "12 to 1:30pm": a start later than the end is probably meant in the same half of the day.
  if (start >= end && end > 12 * 60 && start >= 12 * 60 && start - 12 * 60 < end) start -= 12 * 60;
  if (start >= end) return { reason: "The unavailable range ends before it starts." };
  const days = day ? [day] : vocab.days;
  const notes = days.length > 1 ? [`Applies to ${days[0]} only. Add "on day 2" in another sentence for the other days.`] : [];
  void t;
  return { sourceText: text, preferenceOnly: false, notes, body: { id: "", kind: "court_blackout", courtIds: courts, window: { day: days[0]!, start, end } }, strength: "mandatory" };
}

function timeWindow(text: string, t: string, vocab: InstructionVocabulary, day: string | undefined): Outcome | null {
  const target = targetOf(text, vocab);
  const timeWord = /\b(morning|afternoon|evening)\b/.exec(t)?.[1];
  const notBefore = new RegExp(`\\b(?:before|earlier than|not before)\\s+(${TIME_RE})`, "i").exec(text);
  const after = new RegExp(`\\b(?:after|from|starting at)\\s+(${TIME_RE})`, "i").exec(text);
  const finishBy = new RegExp(`\\b(?:finish|end|done|complete)\\w*\\s+(?:by|before)\\s+(${TIME_RE})`, "i").exec(text);
  const startNoLater = new RegExp(`\\bstart\\w*\\s+(?:no later than|by|before)\\s+(${TIME_RE})`, "i").exec(text);
  const startBefore = /\bstart\w*\s+before\b/i.test(text);
  if (!target || !(timeWord || notBefore || after || finishBy || startNoLater)) return null;

  const body: InstructionBody = { id: "", kind: "time_window", selector: target.selector };
  const bound = (minute: number) => (day ? { day, minute } : { minute });
  const notes: string[] = [];
  const negated = /\b(cannot|can't|can not|not|no|never)\b/i.test(t);
  if (timeWord === "morning") {
    body.latestEnd = bound(12 * 60);
    notes.push('"Morning" was taken as: matches end by 12:00.');
  } else if (timeWord === "afternoon") {
    body.earliestStart = bound(12 * 60);
    notes.push('"Afternoon" was taken as: matches start at or after 12:00.');
  } else if (timeWord === "evening") {
    body.earliestStart = bound(17 * 60);
    notes.push('"Evening" was taken as: matches start at or after 17:00.');
  } else if (startNoLater) {
    const m = parseTime(startNoLater[1]!);
    if (m === null) return { reason: "I could not read that time." };
    // "cannot start before 1 PM" is a lower bound; "must start before 1 PM" or "start by 1 PM" is an upper bound.
    if (startBefore && negated) body.earliestStart = bound(m);
    else body.latestStart = bound(m);
  } else if (finishBy) {
    const m = parseTime(finishBy[1]!);
    if (m === null) return { reason: "I could not read that time." };
    body.latestEnd = bound(m);
  } else if (notBefore && negated) {
    const m = parseTime(notBefore[1]!);
    if (m === null) return { reason: "I could not read that time." };
    body.earliestStart = bound(m);
  } else if (after) {
    const m = parseTime(after[1]!);
    if (m === null) return { reason: "I could not read that time." };
    body.earliestStart = bound(m);
  } else {
    return { reason: "I could not tell whether this is a start or a finish limit. Try: cannot start before 1 PM, or must finish by 17:00." };
  }
  if (!day && vocab.days.length > 1) notes.push("Applies on every tournament day.");
  return { sourceText: text, preferenceOnly: false, notes, body, strength: strengthFrom(text) };
}

function interpret(sentence: string, vocab: InstructionVocabulary): Outcome {
  const text = sentence.trim();
  const t = norm(text);
  const base = { sourceText: text, preferenceOnly: false, notes: [] as string[] };
  const { day, note: dayNote } = dayOf(text, vocab);
  if (dayNote) return { reason: dayNote };

  if (/\b(unavailable|closed|blocked|out of service|not available)\b/.test(t) && /\bcourts?\b/.test(t)) return blackout(text, t, vocab, day);

  if (/\breserve\b/.test(t) && /\bcourts?\b/.test(t)) {
    const courts = courtsOf(text, vocab);
    const roles = rolesOf(text);
    if (!courts.length) return { reason: "I could not tell which court to reserve." };
    if (!roles) return { reason: "I could not tell which matches the court is reserved for. Try: Reserve Court 10 for medal matches." };
    return { ...base, body: { id: "", kind: "court_reservation", courtIds: courts, selector: { roles } }, strength: strengthFrom(text) };
  }

  // "Put Low Intermediate men's in courts 4,5,6 and 7" restricts those divisions to those courts, like "only on".
  const placement = /\b(put|place|play|assign|schedule|keep|move)\b/.test(t) && /\b(?:in|on|at|to)\s+courts?\b/.test(t);
  if ((/\bonly\b/.test(t) || placement) && /\bcourts?\b/.test(t)) {
    const courts = courtsOf(text, vocab);
    const target = targetOf(text, vocab);
    if (!courts.length) return { reason: "I could not tell which courts you mean. Try: High Intermediate only on courts 1-4." };
    if (!target) return { reason: "I could not tell which divisions this applies to." };
    return { ...base, body: { id: "", kind: "court_allowlist", selector: target.selector, courtIds: courts }, strength: strengthFrom(text) };
  }

  const rest = /(\d+)\s*(?:min|mins|minutes)\b[^.]*\b(?:rest|recovery|between)\b|\b(?:rest|recovery)\b[^.]*?(\d+)\s*(?:min|mins|minutes)\b/.exec(t);
  if (rest) {
    const minutes = Number(rest[1] ?? rest[2]);
    const target = targetOf(text, vocab);
    if (!target?.selector.divisionIds) return { reason: "I could not tell which divisions the rest rule is for." };
    return { ...base, body: { id: "", kind: "min_rest", divisionIds: target.selector.divisionIds, minutes }, strength: strengthFrom(text) };
  }

  if (/\bconsecutive\b|\bin blocks?\b/.test(t)) {
    const target = targetOf(text, vocab);
    if (!target?.selector.divisionIds) return { reason: "I could not tell which divisions to play in blocks." };
    return { ...base, notes: ["Playing divisions in consecutive blocks is supported as a preference only."], body: { id: "", kind: "consecutive_blocks", divisionIds: target.selector.divisionIds }, strength: "preference", preferenceOnly: true };
  }
  if (/\b(pool|group|preliminary|prelim)\b.*\b(one|same|single)\s+day\b|\bone day\b.*\b(pool|group|preliminary)/.test(t)) {
    return { ...base, notes: ["Only meaningful for events that run on more than one day. It never changes the event dates."], body: { id: "", kind: "same_day_preliminaries" }, strength: "preference", preferenceOnly: true };
  }

  return timeWindow(text, t, vocab, day) ?? { reason: "I did not recognise this as one of the supported patterns." };
}

/** Splits free text into sentences and interprets each independently. */
export function parseInstructions(text: string, vocab: InstructionVocabulary): ParseOutcome {
  const sentences = text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim().replace(/[.!?;]+$/, ""))
    .filter(Boolean);
  const outcome: ParseOutcome = { interpretations: [], unresolved: [] };
  for (const s of sentences) {
    const r = interpret(s, vocab);
    if ("reason" in r) outcome.unresolved.push({ text: s, reason: r.reason });
    else outcome.interpretations.push(r);
  }
  return outcome;
}
