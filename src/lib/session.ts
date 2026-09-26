import type { CapturedImage } from "./image";

// A capture and whatever transcription it currently holds. Lives above the
// views so a new paste can reset the result while the previous one is kept on
// the undo stack — an accidental paste is one ⌘Z away from being restored,
// with its LaTeX intact.
export type Session = {
  image: CapturedImage;
  latex: string | null;
  provider: string | null;
  seconds: number | null;
};

export type HistoryState = {
  past: Session[];
  present: Session | null;
  future: Session[];
};

export type HistoryAction =
  | { type: "capture"; image: CapturedImage }
  | { type: "result"; imageId: string; latex: string; provider: string; seconds: number }
  | { type: "editLatex"; latex: string }
  | { type: "clear" }
  | { type: "undo" }
  | { type: "redo" };

export const initialHistory: HistoryState = { past: [], present: null, future: [] };

// A new capture or a clear is a history boundary (pushes the current session
// onto `past`). Transcribing or editing LaTeX mutates the present session in
// place — they belong to the same capture, and text edits already have the
// textarea's own native ⌘Z.
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "capture": {
      const session: Session = {
        image: action.image,
        latex: null,
        provider: null,
        seconds: null,
      };
      return {
        past: state.present ? [...state.past, state.present] : state.past,
        present: session,
        future: [],
      };
    }
    case "result": {
      // Guard against a stale in-flight transcription landing on a newer
      // capture: only apply if the result is for the current image.
      if (!state.present || state.present.image.id !== action.imageId) return state;
      return {
        ...state,
        present: {
          ...state.present,
          latex: action.latex,
          provider: action.provider,
          seconds: action.seconds,
        },
      };
    }
    case "editLatex": {
      if (!state.present) return state;
      return { ...state, present: { ...state.present, latex: action.latex } };
    }
    case "clear": {
      if (!state.present) return state;
      return {
        past: [...state.past, state.present],
        present: null,
        future: [],
      };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: state.present ? [state.present, ...state.future] : state.future,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        past: state.present ? [...state.past, state.present] : state.past,
        present: next,
        future: rest,
      };
    }
    default:
      return state;
  }
}
