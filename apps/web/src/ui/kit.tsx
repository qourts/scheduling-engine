import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons.js";

export type Tone = "ok" | "warn" | "bad" | "info";

const TONE_ICON: Record<Tone, IconName> = { ok: "check", warn: "alert", bad: "alert", info: "info" };

export function Banner({ tone, title, children }: { tone: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <span className="banner-icon"><Icon name={TONE_ICON[tone]} /></span>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

/** Friendly placeholder for a screen or section that has nothing to show yet, with the next step. */
export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={24} /></span>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/** Indeterminate brand-gradient progress bar for work in the background. */
export const Progress = ({ label }: { label: string }) => <div className="progress" role="progressbar" aria-label={label} aria-busy="true" />;

/**
 * The official Qourts logo, unmodified, on a light plate. The artwork is transparent with a dark-grey tagline meant for light
 * backgrounds, so it sits on a plate inside the navy shell rather than being recoloured or cropped.
 */
export const LOGO_SRC = "/brand/qourts-official-logo.webp";
export const LOGO_ALT = "Qourts: Smart Queues, Better Games.";

export const Pill = ({ tone, children }: { tone?: Tone | undefined; children: ReactNode }) => <span className={`pill ${tone ?? ""}`}>{children}</span>;

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, help, children, inline }: { label: string; help?: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={`field${inline ? " inline" : ""}`}>
      <span>{label}</span>
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}

export const Stat = ({ value, label }: { value: ReactNode; label: string }) => (
  <div className="stat">
    <b>{value}</b>
    <span>{label}</span>
  </div>
);
