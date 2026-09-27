import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type HistoryEntry, relativeTime } from "../lib/history";
import { HintBar } from "./ui";

type Props = {
  onOpen: (entry: HistoryEntry) => void;
  onClose: () => void;
};

export function HistoryPanel({ onOpen, onClose }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  const refresh = () => {
    void invoke<HistoryEntry[]>("get_history").then(setEntries);
  };
  useEffect(refresh, []);

  const remove = async (id: string) => {
    await invoke("delete_history_entry", { id });
    refresh();
  };
  const clearAll = async () => {
    await invoke("clear_history");
    refresh();
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3.5">
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="text-[11px] text-ink-3 hover:text-ink-2">
            ‹ Back
          </button>
          {entries && entries.length > 0 && (
            <button onClick={() => void clearAll()} className="text-[11px] text-ink-3 hover:text-ink-2">
              Clear all
            </button>
          )}
        </div>

        {entries === null ? (
          <p className="text-[12px] text-ink-3">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-ink-3">
            No transcriptions yet. They&rsquo;ll show up here.
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-2 hover:border-line-2"
            >
              <button
                onClick={() => onOpen(entry)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <img
                  src={entry.thumbnail}
                  alt=""
                  className="h-10 w-16 shrink-0 rounded bg-paper object-contain"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-[11px] text-ink-2">{entry.latex}</span>
                  <span className="text-[10.5px] text-ink-3">
                    {entry.provider} · {relativeTime(entry.createdAt)}
                  </span>
                </span>
              </button>
              <button
                onClick={() => void remove(entry.id)}
                className="shrink-0 px-1 text-[11px] text-ink-3 opacity-0 hover:text-ink-2 group-hover:opacity-100"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <HintBar hints={[{ keys: ["esc"], label: "Close", right: true }]} />
    </div>
  );
}
