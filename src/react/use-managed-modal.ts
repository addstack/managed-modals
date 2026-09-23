"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  IDLE_PRESENTATION,
  type ModalDismissReason,
  type ModalKind,
  type ModalPolicyOverrides,
  type ModalPresentation,
} from "../core/index.js";
import { ManagedModalContext, useModalStore, type ManagedModalContextValue } from "./context.js";

export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type UseManagedModalOptions<Name extends string = string> = {
  /** Policy name. */
  name: Name;
  /** Application intent: this modal wants to be open. */
  open: boolean;
  kind?: ModalKind | undefined;
  /** Overrides the policy priority for this instance. Reactive. */
  priority?: number | undefined;
  /** Overrides other policy fields for this instance. Read when the modal opens. */
  policy?: Omit<ModalPolicyOverrides, "priority"> | undefined;
  /**
   * Called once when the scheduler gives up on this open cycle
   * (see `ModalDismissReason`). Close the modal in response.
   */
  onDismiss?: ((reason: ModalDismissReason) => void) | undefined;
  /**
   * Parent modal request. Defaults to the nearest managed modal in the React
   * tree; pass `null` to always start a separate flow.
   */
  parentRequestId?: string | null | undefined;
};

export type UseManagedModalResult = {
  requestId: string | null;
  presentation: ModalPresentation;
  onExitComplete: () => void;
  /** Provide through `ManagedModalContext` so nested modals and content can find it. */
  contextValue: ManagedModalContextValue;
};

/**
 * Low-level hook: registers one modal with the scheduler and returns what to
 * render. `managed()` roots are built on it; use it directly for primitives
 * that don't follow the `open`/`onOpenChange` convention.
 */
export function useManagedModal<Name extends string = string>(
  options: UseManagedModalOptions<Name>,
): UseManagedModalResult {
  const store = useModalStore();
  const parentContext = useContext(ManagedModalContext);
  const parentRequestId =
    options.parentRequestId === undefined ? (parentContext?.requestId ?? undefined) : (options.parentRequestId ?? undefined);
  const kind = options.kind ?? "dialog";

  // One request id per false -> true cycle, known during render so nested
  // modals rendered in the same pass can point at it.
  const instanceId = useId();
  const [cycle, setCycle] = useState(0);
  const [wasOpen, setWasOpen] = useState(options.open);
  if (options.open !== wasOpen) {
    setWasOpen(options.open);
    if (options.open) setCycle(cycle + 1);
  }
  const requestId = options.open ? `${instanceId}#${cycle}` : null;

  const latest = useRef(options);
  useIsomorphicLayoutEffect(() => {
    latest.current = options;
  });

  const lastRequestIdRef = useRef<string | null>(null);

  const presentation = useSyncExternalStore(
    store.subscribe,
    () => store.getPresentation(requestId),
    () => IDLE_PRESENTATION,
  );

  useIsomorphicLayoutEffect(() => {
    if (!requestId) return;
    lastRequestIdRef.current = requestId;
    const { name, priority, policy } = latest.current;
    store.request({
      requestId,
      instanceId,
      name,
      kind,
      parentRequestId,
      overrides: { ...policy, priority },
    });
    return () => store.cancel(requestId);
  }, [store, requestId, instanceId, kind, parentRequestId]);

  useIsomorphicLayoutEffect(() => {
    if (requestId) store.updatePriority(requestId, options.priority);
  }, [store, requestId, options.priority]);

  // Declared after the registration effect so that on unmount it runs after
  // `cancel`: an unmounted modal has no exit animation to wait for.
  useIsomorphicLayoutEffect(
    () => () => {
      if (lastRequestIdRef.current) store.exitComplete(lastRequestIdRef.current);
    },
    [store],
  );

  const handledDismissRef = useRef<string | null>(null);
  useEffect(() => {
    if (presentation.status !== "dismissed" || !requestId || handledDismissRef.current === requestId) return;
    handledDismissRef.current = requestId;
    latest.current.onDismiss?.(presentation.dismissReason ?? "blocked");
  }, [presentation, requestId]);

  const onExitComplete = useCallback(() => {
    if (lastRequestIdRef.current) store.exitComplete(lastRequestIdRef.current);
  }, [store]);

  const contextValue = useMemo<ManagedModalContextValue>(
    () => ({ requestId, name: options.name, kind, presentation, onExitComplete }),
    [requestId, options.name, kind, presentation, onExitComplete],
  );

  return { requestId, presentation, onExitComplete, contextValue };
}
