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
};

export const ManagedModalContext = createContext<ManagedModalContextValue | null>(null);

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
