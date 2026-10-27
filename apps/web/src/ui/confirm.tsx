import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons.js";

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button as destructive and focuses Cancel first. */
  tone?: "default" | "danger";
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const Context = createContext<Confirm | null>(null);

/** Branded replacement for window.confirm. Falls back to the native dialog if no provider is mounted (for example in isolated tests). */
export function useConfirm(): Confirm {
  const ctx = useContext(Context);
  return ctx ?? ((o) => Promise.resolve(window.confirm(`${o.title}${typeof o.body === "string" ? `\n\n${o.body}` : ""}`)));
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const secondary = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        opener.current = document.activeElement as HTMLElement | null;
        setOpen({ options, resolve });
      }),
    [],
  );

  const close = (value: boolean) => {
    open?.resolve(value);
    setOpen(null);
    opener.current?.focus?.();
  };

  useEffect(() => {
    if (!open) return;
    (open.options.tone === "danger" ? secondary : primary).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Tab") {
        const first = secondary.current;
        const last = primary.current;
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const o = open?.options;
  return (
    <Context.Provider value={confirm}>
      {children}
      {o && (
        <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby={o.body ? "dlg-body" : undefined}>
            <div className="row top" style={{ flexWrap: "nowrap" }}>
              <span className={`pill ${o.tone === "danger" ? "bad" : "info"}`} style={{ padding: 8 }}><Icon name={o.tone === "danger" ? "alert" : "info"} /></span>
              <div className="stack tight">
                <h2 id="dlg-title">{o.title}</h2>
                {o.body && <div id="dlg-body" className="muted">{o.body}</div>}
              </div>
            </div>
            <div className="dialog-actions">
              <button ref={secondary} className="btn" onClick={() => close(false)}>{o.cancelLabel ?? "Cancel"}</button>
              <button ref={primary} className={`btn ${o.tone === "danger" ? "danger" : "primary"}`} onClick={() => close(true)}>{o.confirmLabel ?? "Continue"}</button>
            </div>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}
