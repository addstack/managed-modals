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
import {
  ActivityStateContext,
  ManagedModalContext,
  NestedRequestsContext,
  useModalStore,
  type ManagedModalContextValue,
} from "./context.js";
import { restoreScrollPositions } from "./scroll-positions.js";

export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const CLOSING_SUSPENDED: ModalPresentation = Object.freeze({
  status: "suspended",
  open: false,
  keepMounted: false,
  suppressFinalFocus: true,
});

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
  /**
   * Value for the primitive's `open` prop: `presentation.open`, and also
   * `true` while the modal is suspended behind a `<ModalActivity>`, which
   * hides the content and keeps its state.
   */
  rootOpen: boolean;
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

  const storePresentation = useSyncExternalStore(
    store.subscribe,
    () => store.getPresentation(requestId),
    () => IDLE_PRESENTATION,
  );

  // A suspended modal that the application closes must not show up while its
  // primitive takes the content down: Radix would play the exit animation of
  // content the `keepMounted` integration was hiding. For that one commit the
  // content still reads the modal as suspended, no longer kept mounted.
  const [previousStatus, setPreviousStatus] = useState(storePresentation.status);
  const [closingSuspended, setClosingSuspended] = useState(false);
  if (storePresentation.status !== previousStatus) {
    setPreviousStatus(storePresentation.status);
    if (previousStatus === "suspended" && requestId === null) setClosingSuspended(true);
  }
  useIsomorphicLayoutEffect(() => {
    if (closingSuspended) setClosingSuspended(false);
  }, [closingSuspended]);
  const presentation = closingSuspended ? CLOSING_SUSPENDED : storePresentation;

  // Set inside a parent's <ModalActivity>. React cleans up the effects of
  // content an <Activity> hides as if it unmounted; while the boundary hides
  // this modal with its suspended flow, the request is handed to the boundary
  // instead of cancelled, and taken back when the content is revealed.
  const nested = useContext(NestedRequestsContext);

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
    nested?.reclaim(requestId);
    return () => {
      if (nested?.hiding()) nested.adopt(requestId);
      else store.cancel(requestId);
    };
  }, [store, requestId, instanceId, kind, parentRequestId, nested]);

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

  // Coming back from a suspension: put back scroll positions the browser lost
  // while the content was hidden (Firefox). Nested content revealed a commit
  // later, or a primitive that shows its content a frame later, is caught by
  // the frame callback.
  const suspendedRef = useRef(false);
  useIsomorphicLayoutEffect(() => {
    if (storePresentation.status === "suspended") {
      suspendedRef.current = true;
      return;
    }
    if (!suspendedRef.current || !storePresentation.open) return;
    suspendedRef.current = false;
    restoreScrollPositions();
    const frame = requestAnimationFrame(restoreScrollPositions);
    return () => cancelAnimationFrame(frame);
  }, [storePresentation]);

  const handledDismissRef = useRef<string | null>(null);
  useEffect(() => {
    if (storePresentation.status !== "dismissed" || !requestId || handledDismissRef.current === requestId) return;
    handledDismissRef.current = requestId;
    latest.current.onDismiss?.(storePresentation.dismissReason ?? "blocked");
  }, [storePresentation, requestId]);

  const onExitComplete = useCallback(() => {
    if (lastRequestIdRef.current) store.exitComplete(lastRequestIdRef.current);
  }, [store]);

  // `<ModalActivity>` boundaries in the content. While one is there, a
  // suspended modal stays open in the primitive and the boundary hides it.
  const [activities, setActivities] = useState<ReadonlySet<string>>(() => new Set());
  const registerActivity = useCallback((id: string) => {
    setActivities((current) => (current.has(id) ? current : new Set(current).add(id)));
    return () =>
      setActivities((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
  }, []);
  // Inside a hidden <ModalActivity> this modal's effects are cleaned up and
  // its request cancelled; keep the primitive as it was until it is back.
  const activityState = useContext(ActivityStateContext);
  const lastRootOpenRef = useRef(false);
  const rootOpen =
    activityState !== "visible" && requestId !== null && storePresentation.status === "idle"
      ? lastRootOpenRef.current
      : storePresentation.open || (storePresentation.status === "suspended" && activities.size > 0);
  useIsomorphicLayoutEffect(() => {
    lastRootOpenRef.current = rootOpen;
  });

  const contextValue = useMemo<ManagedModalContextValue>(
    () => ({ requestId, name: options.name, kind, presentation, onExitComplete, registerActivity }),
    [requestId, options.name, kind, presentation, onExitComplete, registerActivity],
  );

  return { requestId, presentation, rootOpen, onExitComplete, contextValue };
}
