import type { InstructionBody, SchedulingInstruction } from "@engine";

export const DEFAULT_PREFERENCE_WEIGHT = 5;

/**
 * Combines a reviewed proposal with the strength the OPERATOR chose. There is deliberately no default strength: a
 * proposal whose wording did not decide it cannot be finalised until the operator picks one.
 */
export function finalizeRule(body: InstructionBody, id: string, strength: "mandatory" | "preference", weight: number = DEFAULT_PREFERENCE_WEIGHT): SchedulingInstruction {
  const withId = { ...body, id } as InstructionBody;
  return strength === "mandatory" ? { ...withId, strength: "mandatory" } : { ...withId, strength: "preference", weight };
}
