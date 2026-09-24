import type { ModalDismissReason, ModalRequestStatus, ModalSchedulerState } from "./types.js";

export type ModalPresentationStatus = "idle" | ModalRequestStatus;

/**
 * Everything a Dialog/Drawer adapter needs to render one modal. It separates
 * application intent (`open` passed by the app) from what may be on screen.
 */
export type ModalPresentation = {
  /**
   * `idle` when the modal is closed or not registered yet. `suspended` also
   * covers a modal that was shown and is chosen again, but waits for another
   * modal's exit animation.
   */
  status: ModalPresentationStatus;
  /** Whether the modal is on screen. */
  open: boolean;
  dismissReason?: ModalDismissReason;
};

export const IDLE_PRESENTATION: ModalPresentation = Object.freeze({ status: "idle", open: false });

export function getModalPresentation<Name extends string>(
  state: ModalSchedulerState<Name>,
  requestId: string | null | undefined,
): ModalPresentation {
  const request = requestId ? state.requests[requestId] : undefined;
  if (!request) return IDLE_PRESENTATION;

  switch (request.status) {
    case "active":
    case "covered": {
      if (state.entryBlocked.includes(request.requestId)) {
        // Chosen, but waiting for another modal's exit animation.
        return request.hasBeenPresented ? { status: "suspended", open: false } : { status: "pending", open: false };
      }
      return { status: request.status, open: true };
    }
    case "suspended":
      return { status: "suspended", open: false };
    case "dismissed":
      return {
        status: "dismissed",
        open: false,
        ...(request.dismissReason ? { dismissReason: request.dismissReason } : {}),
      };
    case "pending":
      return { status: "pending", open: false };
  }
}

export function isSamePresentation(a: ModalPresentation, b: ModalPresentation): boolean {
  return a.status === b.status && a.open === b.open && a.dismissReason === b.dismissReason;
}
