"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";

import {
  createModalManager,
  type ModalManager,
  type ModalManagerConfig,
  type ModalName,
  type ModalPolicies,
  type ModalSchedulerState,
  type ModalSchedulerStore,
} from "../core/index.js";
import { ModalStoreContext, useModalStore } from "./context.js";
import { rememberScrollPositions } from "./scroll-positions.js";
import { createManagedRoot, type ManagedOptions, type ManagedRootProps } from "./managed.js";
import { useManagedModal, type UseManagedModalOptions, type UseManagedModalResult } from "./use-managed-modal.js";

export type ModalProviderProps<Name extends string> = {
  children?: ReactNode;
  /** Use an existing store (tests, devtools, sharing across roots). */
  store?: ModalSchedulerStore<Name> | undefined;
};

export type ManagedModals<Policies extends ModalPolicies> = {
  manager: ModalManager<Policies>;
  /** Owns the scheduler state. Render once near the root of the app. */
  ModalProvider: ComponentType<ModalProviderProps<ModalName<Policies>>>;
  /**
   * Wraps a Dialog/Drawer root component. Its `name` prop is typed from the
   * policies, and its `open` prop becomes a request to the scheduler.
   */
  managed<P extends object>(
    Root: ComponentType<P>,
    options: ManagedOptions,
  ): ComponentType<ManagedRootProps<P, ModalName<Policies>>>;
  useManagedModal(options: UseManagedModalOptions<ModalName<Policies>>): UseManagedModalResult;
  /** Current scheduler state (for debugging UIs). */
  useModalSchedulerState(): ModalSchedulerState<ModalName<Policies>>;
};

/**
 * Creates typed, managed modal building blocks for one set of policies.
 *
 * ```tsx
 * export const { ModalProvider, managed } = createManagedModals({
 *   policies: { "session-expired": { priority: 100 }, onboarding: { priority: 10 } },
 * })
 * export const Dialog = managed(ShadcnDialog, { kind: "dialog", adapter: adapters.radix })
 * ```
 */
export function createManagedModals<const Policies extends ModalPolicies>(
  config: ModalManagerConfig<Policies>,
): ManagedModals<Policies> {
  type Name = ModalName<Policies>;
  const manager = createModalManager(config);

  function ModalProvider({ children, store }: ModalProviderProps<Name>) {
    const [ownStore] = useState(() => store ?? manager.createStore());
    useEffect(() => () => ownStore.dispose(), [ownStore]);
    useEffect(() => rememberScrollPositions(document), []);
    return (
      <ModalStoreContext.Provider value={ownStore as unknown as ModalSchedulerStore<string>}>{children}</ModalStoreContext.Provider>
    );
  }

  function useModalSchedulerState(): ModalSchedulerState<Name> {
    const store = useModalStore();
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) as ModalSchedulerState<Name>;
  }

  return {
    manager,
    ModalProvider,
    managed: (Root, options) => createManagedRoot(Root, options),
    useManagedModal,
    useModalSchedulerState,
  };
}
