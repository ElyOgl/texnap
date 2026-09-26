// True when a keyboard event is happening inside a text field, so global
// shortcuts (⏎ transcribe, ⌘C copy, ⌘Z undo) can defer to native behaviour
// there — Enter inserts a newline, ⌘C/⌘Z do text copy/undo in the editor.
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || el.isContentEditable;
}
