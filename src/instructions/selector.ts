import type { Id } from "../config/types.js";
import type { Inventory, Match, MatchId } from "../inventory/types.js";
import type { MatchRole, MatchSelector } from "./types.js";

/** Roles of every knockout match, derived from the inventory's bracket structure. */
export function matchRoles(inventory: Inventory): ReadonlyMap<MatchId, ReadonlySet<MatchRole>> {
  const roles = new Map<MatchId, Set<MatchRole>>();
  const add = (id: MatchId, ...rs: MatchRole[]) => {
    const set = roles.get(id) ?? new Set<MatchRole>();
    for (const r of rs) set.add(r);
    roles.set(id, set);
  };
  for (const division of inventory.divisions) {
    for (const stage of division.stages) {
      if (stage.kind !== "knockout") continue;
      add(stage.finalMatchId, "final", "medal");
      if (stage.thirdPlaceMatchId) add(stage.thirdPlaceMatchId, "third_place", "medal");
      const fromEnd = (k: number) => stage.rounds[stage.rounds.length - 1 - k] ?? [];
      for (const id of fromEnd(1)) add(id, "semifinal");
      for (const id of fromEnd(2)) add(id, "quarterfinal");
    }
  }
  return roles;
}

/** Evaluates selectors against matches. Build once per inventory. */
export class SelectorIndex {
  private readonly roles: ReadonlyMap<MatchId, ReadonlySet<MatchRole>>;
  private readonly categoryOfDivision: ReadonlyMap<Id, Id>;

  constructor(readonly inventory: Inventory) {
    this.roles = matchRoles(inventory);
    this.categoryOfDivision = new Map(inventory.config.divisions.map((d) => [d.id, d.categoryId]));
  }

  matches(selector: MatchSelector, match: Match): boolean {
    if (selector.divisionIds && !selector.divisionIds.includes(match.divisionId)) return false;
    if (selector.categoryIds && !selector.categoryIds.includes(this.categoryOfDivision.get(match.divisionId)!)) return false;
    if (selector.stageIds && !selector.stageIds.includes(match.stageId)) return false;
    if (selector.phases && !selector.phases.includes(match.phase)) return false;
    if (selector.matchIds && !selector.matchIds.includes(match.id)) return false;
    if (selector.roles) {
      const own = this.roles.get(match.id);
      if (!own || !selector.roles.some((r) => own.has(r))) return false;
    }
    return true;
  }

  select(selector: MatchSelector): Match[] {
    return this.inventory.matches.filter((m) => this.matches(selector, m));
  }
}
