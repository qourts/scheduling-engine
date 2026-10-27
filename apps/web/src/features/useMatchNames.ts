import { useCallback, useEffect, useState } from "react";
import { plainRuleIds } from "../domain/editing.js";
import { useWorkspace } from "../state/workspace.js";

/**
 * Readable names for the engine's technical match ids ("MD-ADV:ko:R1:M1" becomes "MD-ADV SF1") in warnings and messages.
 * Presentation only: the engine's wording and numbers are untouched.
 */
export function useMatchNames(): (text: string) => string {
  const w = useWorkspace();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    if (w.config) void w.runner.matchInfo(w.config).then((m) => live && setNames(new Map(m.map((x) => [x.id, `${x.divisionId} ${x.label}`])))).catch(() => live && setNames(new Map()));
    return () => {
      live = false;
    };
  }, [w.config, w.runner]);
  return useCallback((text: string) => plainRuleIds(text, names), [names]);
}
