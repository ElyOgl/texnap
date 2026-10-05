import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type HistoryEntry, relativeTime } from "../lib/history";
import { TagEditor } from "./Tags";
import { HintBar } from "./ui";
import { useI18n } from "../lib/i18n";

type Props = {
  onOpen: (entry: HistoryEntry) => void;
  onClose: () => void;
  /** F2: build a fiche (PDF/.tex) from the chosen entries. */
  onCreateSheet: (entries: HistoryEntry[]) => void;
};

const tagsOf = (e: HistoryEntry) => e.tags ?? [];

/// F1 library: the saved-transcriptions store, searchable by LaTeX + tags,
/// filterable by tag, with a pinned section on top. (Was HistoryPanel — the
/// history *is* the library now; tagging/pinning keeps an entry past the cap.)
export function LibraryPanel({ onOpen, onClose, onCreateSheet }: Props) {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const refresh = () => void invoke<HistoryEntry[]>("get_history").then(setEntries);
  useEffect(refresh, []);

  // ⌘F focuses the search field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" && e.metaKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const remove = async (id: string) => {
    await invoke("delete_history_entry", { id });
    refresh();
  };
  const clearUncurated = async () => {
    await invoke("clear_uncurated");
    refresh();
  };
  const setTags = async (id: string, tags: string[]) => {
    await invoke("set_entry_tags", { id, tags });
    refresh();
  };
  const togglePin = async (entry: HistoryEntry) => {
    await invoke("set_entry_pinned", { id: entry.id, pinned: !entry.pinned });
    refresh();
  };

  // Every tag in use, by descending frequency then alpha — the filter row.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries ?? [])
      for (const t of tagsOf(e)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.keys()].sort(
      (a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b),
    );
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      if (activeTag && !tagsOf(e).some((t) => t === activeTag)) return false;
      if (!q) return true;
      return (
        e.latex.toLowerCase().includes(q) ||
        tagsOf(e).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [entries, query, activeTag]);

  const pinned = filtered.filter((e) => e.pinned);
  const rest = filtered.filter((e) => !e.pinned);
  const hasUncurated = (entries ?? []).some((e) => !e.pinned && tagsOf(e).length === 0);

  const selectAllShown = () =>
    setSelected((prev) => new Set([...prev, ...filtered.map((e) => e.id)]));
  const createSheet = () => {
    const chosen = (entries ?? []).filter((e) => selected.has(e.id));
    if (chosen.length) onCreateSheet(chosen);
  };
  const cancelSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  // In selection mode a row is a checkbox toggle (no open/tag/pin controls).
  const selectRow = (entry: HistoryEntry) => {
    const isSel = selected.has(entry.id);
    return (
      <button
        key={entry.id}
        onClick={() => toggleSelected(entry.id)}
        className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left ${
          isSel ? "border-accent bg-accent/10" : "border-line bg-surface-2 hover:border-line-2"
        }`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            isSel ? "border-accent bg-accent text-accent-ink" : "border-line-2 text-transparent"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </span>
        <img src={entry.thumbnail} alt="" className="h-9 w-14 shrink-0 rounded bg-paper object-contain" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[11px] text-ink-2">{entry.latex}</span>
          <span className="truncate text-[10.5px] text-ink-3">
            {tagsOf(entry).join(", ") || entry.provider} · {relativeTime(entry.createdAt, lang)}
          </span>
        </span>
      </button>
    );
  };

  const row = (entry: HistoryEntry) =>
    selecting ? (
      selectRow(entry)
    ) : (
    <div
      key={entry.id}
      className="group flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-2 hover:border-line-2"
    >
      <button onClick={() => onOpen(entry)} className="shrink-0" title={t("library.open")}>
        <img
          src={entry.thumbnail}
          alt=""
          className="h-10 w-16 rounded bg-paper object-contain"
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button onClick={() => onOpen(entry)} className="min-w-0 text-left">
          <span className="block truncate font-mono text-[11px] text-ink-2">{entry.latex}</span>
        </button>
        <TagEditor
          tags={tagsOf(entry)}
          suggestions={allTags}
          onChange={(tags) => void setTags(entry.id, tags)}
          compact
        />
        <span className="text-[10.5px] text-ink-3">
          {entry.provider} · {relativeTime(entry.createdAt, lang)}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <button
          onClick={() => void togglePin(entry)}
          title={entry.pinned ? t("library.unpin") : t("library.pin")}
          className={entry.pinned ? "text-accent" : "text-ink-3 opacity-0 hover:text-ink-2 group-hover:opacity-100"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={entry.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 4v6l-2 4h10l-2 -4v-6" />
            <path d="M12 14v7" />
            <path d="M8 4h8" />
          </svg>
        </button>
        <button
          onClick={() => void remove(entry.id)}
          className="text-ink-3 opacity-0 hover:text-ink-2 group-hover:opacity-100"
          title={t("library.remove")}
        >
          ✕
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        <div className="flex items-center justify-between">
          <button
            onClick={selecting ? cancelSelect : onClose}
            className="text-[11px] text-ink-3 hover:text-ink-2"
          >
            {selecting ? t("common.cancel") : t("common.back")}
          </button>
          <span className="text-[13px] font-medium text-ink">
            {selecting ? t("library.titleSelecting") : t("library.title")}
          </span>
          {selecting ? (
            <button onClick={selectAllShown} className="text-[11px] text-ink-3 hover:text-ink-2">
              {t("library.selectAll")}
            </button>
          ) : (entries?.length ?? 0) > 0 ? (
            <button onClick={() => setSelecting(true)} className="text-[11px] text-accent hover:brightness-110">
              {t("library.createSheet")}
            </button>
          ) : (
            <span className="w-8" />
          )}
        </div>

        {!selecting && (entries?.length ?? 0) > 0 && (
          <div className="flex items-center justify-between text-[11px] text-ink-3">
            <span>{t("library.savedCount", { count: filtered.length })}</span>
            {hasUncurated && (
              <button
                onClick={() => void clearUncurated()}
                className="hover:text-ink-2"
                title={t("library.clearUncuratedTitle")}
              >
                {t("library.clearUncurated")}
              </button>
            )}
          </div>
        )}

        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={t("library.search")}
          spellCheck={false}
          className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/50"
        />

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`rounded-full px-2.5 py-[3px] text-[11px] ${
                activeTag === null ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink-2 hover:text-ink"
              }`}
            >
              {t("library.allTags")}
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`rounded-full px-2.5 py-[3px] text-[11px] ${
                  activeTag === tag ? "bg-accent text-accent-ink" : "bg-surface-3 text-ink-2 hover:text-ink"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {entries === null ? (
          <p className="text-[12px] text-ink-3">{t("library.loading")}</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-ink-3">
            {entries.length === 0 ? t("library.emptyNone") : t("library.emptyNoResult")}
          </p>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                    <path d="M9 4v6l-2 4h10l-2 -4v-6z" />
                  </svg>
                  {t("library.pinned")}
                </div>
                {pinned.map(row)}
                {rest.length > 0 && <div className="h-px bg-line" />}
              </>
            )}
            {rest.map(row)}
          </>
        )}
      </div>

      {selecting ? (
        <div className="flex items-center justify-between border-t border-line bg-titlebar px-3.5 py-2.5">
          <span className="text-[11px] text-ink-2">{t("library.selectedCount", { count: selected.size })}</span>
          <button
            onClick={createSheet}
            disabled={selected.size === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-40"
          >
            {t("library.createSheetArrow")}
          </button>
        </div>
      ) : (
        <HintBar
          hints={[
            { keys: ["⌘", "F"], label: t("hint.search") },
            { keys: ["esc"], label: t("hint.close"), right: true },
          ]}
        />
      )}
    </div>
  );
}
