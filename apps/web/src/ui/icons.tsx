import type { ReactNode } from "react";

/** One consistent icon set: 24px grid, 1.8px rounded strokes, currentColor. Decorative unless a title is given. */
const PATHS = {
  lock: (<><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  unlock: (<><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 7.6-1.6" /></>),
  star: <path d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (<><path d="M12 4l9 16H3z" /><path d="M12 10v4.5M12 17.4v.1" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.1" /></>),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  undo: (<><path d="M7 4L3 8l4 4" /><path d="M3 8h10a6 6 0 0 1 0 12h-3" /></>),
  redo: (<><path d="M17 4l4 4-4 4" /><path d="M21 8H11a6 6 0 0 0 0 12h3" /></>),
  left: <path d="M15 6l-6 6 6 6" />,
  right: <path d="M9 6l6 6-6 6" />,
  download: (<><path d="M12 4v11M7 10.5l5 5 5-5" /><path d="M5 20h14" /></>),
  printer: (<><path d="M7 9V4h10v5" /><path d="M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17" /><path d="M7 14h10v6H7z" /></>),
  swap: (<><path d="M7 7h13l-4-4" /><path d="M17 17H4l4 4" /></>),
  locate: (<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>),
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></>),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  calendar: (<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  grid: (<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  file: (<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}>
      {PATHS[name]}
    </svg>
  );
}
