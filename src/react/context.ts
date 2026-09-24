"use client";

import { createContext, useContext } from "react";

import type { ModalKind, ModalPresentation, ModalSchedulerStore } from "../core/index.js";

export const ModalStoreContext = createContext<ModalSchedulerStore<string> | null>(null);

export type ManagedModalContextValue = {
  /** Current open cycle, or `null` while closed. Nested managed modals attach to it. */
  requestId: string | null;
  name: string;
  kind: ModalKind;
  presentation: ModalPresentation;
  /**
   * Call when the primitive finished its close animation. Only needed with
   * `awaitExit`; adapters for Base UI and vaul call it for you.
   */
  onExitComplete: () => void;
  /**
   * Called by `<ModalActivity>` with its own id. Returns the unregister
   * function. While a boundary is registered, a suspended modal stays open
   * in the primitive and the boundary hides its content.
   */
  registerActivity: (id: string) => () => void;
};

export const ManagedModalContext = createContext<ManagedModalContextValue | null>(null);

/**
 * Set by `<ModalActivity>` for its content. `"hidden"` while the boundary
 * hides it, `"revealing"` for the commit in which it comes back.
 *
 * React cleans up effects in hidden content as if it unmounted, so a managed
 * modal nested in it leaves the scheduler and registers again when it is
 * revealed. In between, it keeps its primitive open instead of closing it.
 */
export type ActivityState = "visible" | "hidden" | "revealing";
export const ActivityStateContext = createContext<ActivityState>("visible");

/**
 * Provided by `<ModalActivity>` to its content: keeps the requests of managed
 * modals nested in it registered while the boundary hides them.
 */
export type NestedRequests = {
  /** Whether the boundary hides its content now, because its modal is suspended. */
  hiding(): boolean;
  /** A nested modal hidden by the boundary hands its request over. */
  adopt(requestId: string): void;
  /** A nested modal that is back takes its request over again. */
  reclaim(requestId: string): void;
};
export const NestedRequestsContext = createContext<NestedRequests | null>(null);

/** The nearest managed modal, or `null` when rendered outside of one. */
export function useManagedModalContext(): ManagedModalContextValue | null {
  return useContext(ManagedModalContext);
}

/**
 * Presentation of the nearest managed modal, for content components
 * (e.g. shadcn `DialogContent`) that want to keep content mounted while the
 * modal is suspended or skip focus restoration. `null` outside a managed modal.
 */
export function useModalPresentation(): ModalPresentation | null {
  return useContext(ManagedModalContext)?.presentation ?? null;
}

export function useModalStore(): ModalSchedulerStore<string> {
  const store = useContext(ModalStoreContext);
  if (!store) {
    throw new Error("managed-modals: no store found. Render managed modals inside <ModalProvider>.");
  }
  return store;
}
