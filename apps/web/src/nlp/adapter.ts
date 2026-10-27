import type { InstructionBody, InstructionVocabulary } from "@engine";
import type { Interpretation, ParseOutcome } from "./parser.js";

/**
 * Optional AI interpreter, reached only through a same-origin backend endpoint. The browser never holds an API key and the
 * app works fully without this adapter. Whatever comes back is only a PROPOSAL: it goes through the same operator review and
 * engine validation as the deterministic parser.
 */
export interface AiStatus {
  available: boolean;
}

export async function aiStatus(fetchImpl: typeof fetch = fetch): Promise<AiStatus> {
  try {
    const res = await fetchImpl("/api/interpret/status", { headers: { accept: "application/json" } });
    if (!res.ok) return { available: false };
    const data: unknown = await res.json();
    return { available: typeof data === "object" && data !== null && (data as { available?: unknown }).available === true };
  } catch {
    return { available: false };
  }
}

const KINDS = new Set(["time_window", "court_allowlist", "court_reservation", "court_blackout", "min_rest", "locked_placement", "consecutive_blocks", "same_day_preliminaries"]);

/** Defensive mapping of the backend payload. Anything malformed is dropped into `unresolved` rather than trusted. */
export function mapAiResponse(data: unknown): ParseOutcome {
  const out: ParseOutcome = { interpretations: [], unresolved: [] };
  if (typeof data !== "object" || data === null) return { ...out, unresolved: [{ text: "", reason: "The AI service returned an unreadable answer." }] };
  const { proposals, unresolved } = data as { proposals?: unknown; unresolved?: unknown };
  for (const p of Array.isArray(proposals) ? proposals : []) {
    const item = p as { sourceText?: unknown; body?: unknown; strength?: unknown; notes?: unknown };
    const body = item.body as { kind?: unknown } | undefined;
    if (typeof item.sourceText !== "string" || !body || typeof body.kind !== "string" || !KINDS.has(body.kind)) {
      out.unresolved.push({ text: typeof item.sourceText === "string" ? item.sourceText : "", reason: "The AI service proposed something this app does not support." });
      continue;
    }
    const preferenceOnly = body.kind === "consecutive_blocks" || body.kind === "same_day_preliminaries";
    // An AI answer is never trusted to decide strength unless it is exactly one of the two words.
    const strength = preferenceOnly ? "preference" : item.strength === "mandatory" || item.strength === "preference" ? item.strength : null;
    const notes = Array.isArray(item.notes) ? item.notes.filter((n): n is string => typeof n === "string") : [];
    const interpretation: Interpretation = { sourceText: item.sourceText, body: body as InstructionBody, strength, preferenceOnly, notes: ["Interpreted by AI. Check carefully.", ...notes] };
    out.interpretations.push(interpretation);
  }
  for (const u of Array.isArray(unresolved) ? unresolved : []) {
    const item = u as { text?: unknown; reason?: unknown };
    out.unresolved.push({ text: typeof item.text === "string" ? item.text : "", reason: typeof item.reason === "string" ? item.reason : "Not understood." });
  }
  return out;
}

export async function aiInterpret(text: string, vocabulary: InstructionVocabulary, fetchImpl: typeof fetch = fetch): Promise<ParseOutcome> {
  const res = await fetchImpl("/api/interpret", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, vocabulary }) });
  if (!res.ok) throw new Error(`The AI service is not available right now (${res.status}).`);
  return mapAiResponse(await res.json());
}
