"use client";

// Firefox resets the scroll position of an element that gets `display: none`,
// which is how a suspended modal's content is hidden (`hidden`, or
// `<Activity>`). Positions inside dialogs are remembered as the user scrolls
// and put back when a modal comes back. Other browsers keep them; then this
// does nothing.

type Position = { top: number; left: number };

const DIALOG = '[role="dialog"], [role="alertdialog"]';
const positions = new Map<Element, Position>();
let listeners = 0;

function remember(event: Event): void {
  const target = event.target;
  // Ignore elements that are not rendered: a reset caused by hiding is not a position to keep.
  if (!(target instanceof Element) || target.getClientRects().length === 0 || !target.closest(DIALOG)) return;
  positions.set(target, { top: target.scrollTop, left: target.scrollLeft });
}

/** Starts remembering scroll positions inside dialogs. Returns the stop function. */
export function rememberScrollPositions(doc: Document): () => void {
  if (listeners++ === 0) doc.addEventListener("scroll", remember, true);
  return () => {
    if (--listeners === 0) {
      doc.removeEventListener("scroll", remember, true);
      positions.clear();
    }
  };
}

/** Puts back remembered positions that the browser lost, on elements that are rendered again. */
export function restoreScrollPositions(): void {
  for (const [element, position] of positions) {
    if (!element.isConnected) {
      positions.delete(element);
      continue;
    }
    if (element.getClientRects().length === 0) continue;
    if (element.scrollTop !== position.top || element.scrollLeft !== position.left) {
      element.scrollTo(position.left, position.top);
    }
  }
}
