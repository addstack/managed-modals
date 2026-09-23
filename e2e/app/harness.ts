import {
  getDebugSnapshot,
  type ModalDebugEntry,
  type ModalDismissReason,
  type ModalSchedulerState,
} from "../../src/core/index.js";

/** What the application saw, in order: `onOpenChange` and `onDismiss` calls. */
export type HarnessEvent =
  | { type: "open-change"; name: string; open: boolean; t: number }
  | { type: "dismiss"; name: string; reason: ModalDismissReason; t: number };

/** Titles of the dialogs on screen in one animation frame. */
export type Frame = { t: number; shown: string[] };

/** Test-only API, available as `window.e2e` once the fixture has rendered. */
export type Harness = {
  /** Sets the application's intent, like app state (a websocket, a timer) would. */
  setOpen(name: string, open: boolean): void;
  events: HarnessEvent[];
  shownDialogs(): string[];
  debug(): ModalDebugEntry[];
  /** Samples `shownDialogs()` on every animation frame until `stopRecording()`. */
  startRecording(): void;
  stopRecording(): Frame[];
};

declare global {
  interface Window {
    e2e: Harness;
  }
}

const setters = new Map<string, (open: boolean) => void>();

export function registerIntent(name: string, setOpen: (open: boolean) => void): () => void {
  setters.set(name, setOpen);
  return () => {
    if (setters.get(name) === setOpen) setters.delete(name);
  };
}

type Untimed<Event> = Event extends unknown ? Omit<Event, "t"> : never;

export function logEvent(event: Untimed<HarnessEvent>): void {
  window.e2e.events.push({ ...event, t: performance.now() });
}

/**
 * A dialog is on screen when a user could see any of it: rendered, not hidden,
 * not faded out and inside the viewport. A dialog that is animating out counts
 * until its animation has (nearly) finished.
 */
function isShown(element: HTMLElement): boolean {
  if (element.closest("[hidden]")) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 1 &&
    rect.right > 1 &&
    rect.top < window.innerHeight - 1 &&
    rect.left < window.innerWidth - 1
  );
}

function shownDialogs(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
    .filter(isShown)
    .map((element) => element.querySelector("h2")?.textContent ?? "?");
}

export function installHarness(getSnapshot: () => ModalSchedulerState): void {
  let frames: Frame[] | null = null;
  const sample = () => {
    if (!frames) return;
    frames.push({ t: performance.now(), shown: shownDialogs() });
    requestAnimationFrame(sample);
  };

  window.e2e = {
    setOpen(name, open) {
      const setOpen = setters.get(name);
      if (!setOpen) throw new Error(`No modal named "${name}" in the fixture.`);
      setOpen(open);
    },
    events: [],
    shownDialogs,
    debug: () => getDebugSnapshot(getSnapshot()),
    startRecording() {
      frames = [];
      sample();
    },
    stopRecording() {
      // One last sample: the caller has just seen the final state, maybe before the next frame did.
      const recorded = [...(frames ?? []), { t: performance.now(), shown: shownDialogs() }];
      frames = null;
      return recorded;
    },
  };
}
