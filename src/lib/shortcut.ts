import { invoke } from "@tauri-apps/api/core";

const SYMBOLS: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const PUNCT: Record<string, string> = {
  Semicolon: ";", Comma: ",", Period: ".", Slash: "/", Quote: "'",
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\",
};

// Cold-load display of a stored (code-based) accelerator, layout-aware.
// The capture default binds the physical "M" key; on an AZERTY keyboard that
// position is the `,` key, so pass `mGlyph` (from `captureKeyGlyph()`) to show
// ⌃⌘, instead of ⌃⌘M. Everything else maps by key name.
export function prettyShortcut(accel: string, mGlyph?: string): string {
  return accel
    .split("+")
    .map((part) => {
      if (SYMBOLS[part]) return SYMBOLS[part];
      if ((part === "KeyM" || part === "M") && mGlyph) return mGlyph;
      if (/^Key[A-Z]$/.test(part)) return part.slice(3);
      if (/^Digit[0-9]$/.test(part)) return part.slice(5);
      if (PUNCT[part]) return PUNCT[part];
      return part;
    })
    .join(" ");
}

// The character the physical capture key produces under the current macOS
// keyboard layout ("M" on QWERTY, "," on AZERTY). undefined off-macOS/on failure.
export async function captureKeyGlyph(): Promise<string | undefined> {
  try {
    return (await invoke<string | null>("capture_key_glyph")) ?? undefined;
  } catch {
    return undefined;
  }
}
