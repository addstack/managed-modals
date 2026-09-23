import type { ModalDismissReason, ModalRequestStatus, ModalSchedulerState } from "./types.js";

export type ModalPresentationStatus = "idle" | ModalRequestStatus;

/**
 * Everything a Dialog/Drawer adapter needs to render one modal. It separates
 * application intent (`open` passed by the app) from what may be on screen.
 */
export type ModalPresentation = {
  /** `idle` when the modal is closed or not registered yet. */
  status: ModalPresentationStatus;
  /** Pass to the primitive's `open` prop. */
  open: boolean;
  /**
   * The modal has been shown and is still wanted: keep its content mounted
   * (Base UI `keepMounted`, Radix `forceMount`) so that a suspension does not
   * lose its state. Stays `true` across suspend/resume to avoid remounts;
   * becomes `false` when the modal is closed for good.
   */
  keepMounted: boolean;
  /**
   * The modal is closing because the scheduler switched to another modal, not
   * because the user closed it. Do not move focus back to its trigger.
   */
  suppressFinalFocus: boolean;
  dismissReason?: ModalDismissReason;
};

export const IDLE_PRESENTATION: ModalPresentation = Object.freeze({
  status: "idle",
  open: false,
  keepMounted: false,
  suppressFinalFocus: false,
});

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
        return request.hasBeenPresented
          ? { status: "suspended", open: false, keepMounted: true, suppressFinalFocus: true }
          : { status: "pending", open: false, keepMounted: false, suppressFinalFocus: false };
      }
      return { status: request.status, open: true, keepMounted: true, suppressFinalFocus: false };
    }
    case "suspended":
      return { status: "suspended", open: false, keepMounted: true, suppressFinalFocus: true };
    case "dismissed":
      return {
        status: "dismissed",
        open: false,
        keepMounted: false,
        suppressFinalFocus: request.dismissReason === "preempted",
        ...(request.dismissReason ? { dismissReason: request.dismissReason } : {}),
      };
    case "pending":
      return { status: "pending", open: false, keepMounted: false, suppressFinalFocus: false };
  }
}

export function isSamePresentation(a: ModalPresentation, b: ModalPresentation): boolean {
  return (
    a.status === b.status &&
    a.open === b.open &&
    a.keepMounted === b.keepMounted &&
    a.suppressFinalFocus === b.suppressFinalFocus &&
    a.dismissReason === b.dismissReason
  );
}
