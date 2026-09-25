import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export type Hint = {
  keys: string[];
  label: string;
  /** Pushed to the right edge of the bar (e.g. Settings). */
  right?: boolean;
};

export function HintBar({ hints }: { hints: Hint[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line bg-titlebar px-3.5 py-2.5">
      {hints.map((h, i) => (
        <span
          key={i}
          className={`flex items-center gap-1.5 text-[11px] text-ink-3 ${h.right ? "ml-auto" : ""}`}
        >
          {h.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          <span className="text-ink-2">{h.label}</span>
        </span>
      ))}
    </div>
  );
}
