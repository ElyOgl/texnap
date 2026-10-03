import { useId, useRef, useState } from "react";

type Props = {
  tags: string[];
  /** All tags across the library, for autocomplete. */
  suggestions?: string[];
  /** Fires with the full new tag list on any add or remove. */
  onChange: (tags: string[]) => void;
  /** Tighter styling when shown inline in a dense list row. */
  compact?: boolean;
};

/// Chips for an entry's tags plus an inline "+ tag" input with autocomplete.
/// Shared by the library panel (per entry) and the fresh-result view.
export function TagEditor({ tags, suggestions = [], onChange, compact }: Props) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const chip = compact
    ? "text-[9.5px] px-2 py-[1.5px]"
    : "text-[10.5px] px-2 py-0.5";

  const add = () => {
    const t = value.trim();
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      onChange([...tags, t]);
    }
    setValue("");
    // Keep the input open so several tags can be added in a row.
    inputRef.current?.focus();
  };

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  // Suggestions not already applied to this entry.
  const available = suggestions.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`group/tag flex items-center gap-1 rounded-full bg-surface-3 text-ink-2 ${chip}`}
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            className="text-ink-3 hover:text-ink"
            aria-label={`Retirer le tag ${tag}`}
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <>
          <input
            ref={inputRef}
            autoFocus
            value={value}
            list={listId}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setValue("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              add();
              setAdding(false);
            }}
            placeholder="tag…"
            className={`w-24 rounded-full border border-line-2 bg-surface-2 text-ink outline-none focus:border-accent/50 ${chip}`}
          />
          <datalist id={listId}>
            {available.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`flex items-center gap-1 rounded-full border border-dashed border-line-2 text-ink-3 hover:text-ink-2 ${chip}`}
        >
          + tag
        </button>
      )}
    </div>
  );
}
