/**
 * Server-side interpreter for flexible plain-English scheduling requests, using the Anthropic Messages API with a forced
 * tool call so the answer is structured JSON. It only PROPOSES instructions. The app shows every proposal to the operator,
 * the engine validates it against the real tournament, and nothing is applied until confirmed. This module never touches the
 * browser, never logs the key or the request text, and is used only when ANTHROPIC_API_KEY is configured.
 */

export interface InterpretDeps {
  apiKey: string | undefined;
  model: string;
  fetchImpl: typeof fetch;
}

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TEXT = 2000;
const MAX_VOCAB_JSON = 60_000;
const TIMEOUT_MS = 30_000;

export const SYSTEM_PROMPT = `You turn a tournament director's plain-English scheduling requests into structured rules for a tournament scheduler.
Return them by calling the tool propose_rules exactly once. Never answer in prose.

Rules for your output:
- Use only ids from the vocabulary (courts, divisions, categories, days). Never invent ids. If a name is ambiguous or missing, put the sentence in "unresolved" with a reason.
- strength: use "mandatory" ONLY if the person clearly states a hard requirement (must, cannot, never, required, unavailable). Use "preference" ONLY if they clearly state a preference (prefer, ideally, try to). If the wording does not say, use "unclear". Never guess "mandatory".
- Supported rule kinds and their exact body shapes (times are minutes since midnight; "day" is an ISO date from the vocabulary or omitted for every day):
  time_window: {kind, selector:{divisionIds?:[], categoryIds?:[], roles?:["final"|"third_place"|"medal"|"semifinal"|"quarterfinal"]}, earliestStart?:{day?,minute}, latestStart?:{day?,minute}, latestEnd?:{day?,minute}}
  court_allowlist: {kind, selector:{...}, courtIds:[]}
  court_reservation: {kind, courtIds:[], selector:{...}}
  court_blackout: {kind, courtIds:[], window:{day, start, end}}
  min_rest: {kind, divisionIds:[], minutes}
  consecutive_blocks: {kind, divisionIds:[]} (preference only)
  same_day_preliminaries: {kind, divisionIds?:[]} (preference only)
- Always set id to "" in every body. Add "notes" for any interpretation the person should double-check (for example what "morning" was taken to mean).
- Anything else (weather delays, player requests by name, changing formats or dates) is unsupported: put it in "unresolved".`;

export const TOOL = {
  name: "propose_rules",
  description: "Return the scheduling rules proposed for the operator to review.",
  input_schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sourceText: { type: "string", description: "The part of the request this rule came from." },
            strength: { type: "string", enum: ["mandatory", "preference", "unclear"] },
            body: { type: "object", description: "One of the supported rule bodies. Must include kind and id (empty string)." },
            notes: { type: "array", items: { type: "string" } },
          },
          required: ["sourceText", "strength", "body"],
        },
      },
      unresolved: { type: "array", items: { type: "object", properties: { text: { type: "string" }, reason: { type: "string" } }, required: ["text", "reason"] } },
    },
    required: ["proposals", "unresolved"],
  },
} as const;

export function handleStatus(deps: Pick<InterpretDeps, "apiKey">): { available: boolean } {
  return { available: typeof deps.apiKey === "string" && deps.apiKey.length > 10 };
}

export function buildRequest(text: string, vocabulary: unknown, model: string) {
  return {
    model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: `Vocabulary (the only ids you may use):\n${JSON.stringify(vocabulary)}\n\nRequest:\n${text}` }],
  };
}

/** Pulls the forced tool call out of a Messages API response and normalises "unclear" to null. */
export function extractProposals(response: unknown): { proposals: unknown[]; unresolved: unknown[] } | null {
  const content = (response as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  const block = content.find((b): b is { type: string; name: string; input: unknown } => typeof b === "object" && b !== null && (b as { type?: unknown }).type === "tool_use" && (b as { name?: unknown }).name === TOOL.name);
  const input = block?.input as { proposals?: unknown; unresolved?: unknown } | undefined;
  if (!input || !Array.isArray(input.proposals)) return null;
  const proposals = input.proposals.map((p) => {
    const item = p as { strength?: unknown };
    return { ...(p as object), strength: item.strength === "mandatory" || item.strength === "preference" ? item.strength : null };
  });
  return { proposals, unresolved: Array.isArray(input.unresolved) ? input.unresolved : [] };
}

export async function handleInterpret(body: unknown, deps: InterpretDeps): Promise<{ status: number; json: unknown }> {
  if (!handleStatus(deps).available) return { status: 503, json: { error: "AI interpretation is not configured." } };
  const { text, vocabulary } = (body ?? {}) as { text?: unknown; vocabulary?: unknown };
  if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TEXT) return { status: 400, json: { error: `Text must be 1-${MAX_TEXT} characters.` } };
  if (typeof vocabulary !== "object" || vocabulary === null || JSON.stringify(vocabulary).length > MAX_VOCAB_JSON) return { status: 400, json: { error: "Invalid vocabulary." } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await deps.fetchImpl(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": deps.apiKey!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(buildRequest(text, vocabulary, deps.model)),
      signal: controller.signal,
    });
    if (!res.ok) return { status: 502, json: { error: `The AI service returned ${res.status}.` } };
    const extracted = extractProposals(await res.json());
    if (!extracted) return { status: 502, json: { error: "The AI service returned an unexpected answer." } };
    return { status: 200, json: extracted };
  } catch {
    return { status: 502, json: { error: "The AI service could not be reached." } };
  } finally {
    clearTimeout(timer);
  }
}
