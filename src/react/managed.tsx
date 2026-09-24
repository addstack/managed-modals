"use client";

import { useCallback, useContext, useRef, useState, type ComponentType } from "react";

import type { ModalDismissReason, ModalKind, ModalPolicyOverrides } from "../core/index.js";
import type { ModalAdapter } from "./adapters.js";
import { ManagedModalContext, ModalStoreContext } from "./context.js";
import { useIsomorphicLayoutEffect, useManagedModal } from "./use-managed-modal.js";

type OpenChangeRest<P> = P extends { onOpenChange?: infer Handler }
  ? NonNullable<Handler> extends (open: boolean, ...rest: infer Rest) => unknown
    ? Rest
    : []
  : [];

/** `Omit` that keeps unions of props (e.g. vaul's `snapPoints`/`fadeFromIndex`) intact. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ManagedRootOwnProps<Name extends string, Rest extends unknown[] = []> = {
  /**
   * Policy name. Without it the root is the plain primitive, not scheduled,
   * unless it is rendered inside a managed modal: then it joins that modal's
   * flow under the same name.
   */
  name?: Name | undefined;
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  /**
   * Called when the user opens/closes the modal and when the scheduler
   * dismisses it. Never called for scheduler suspensions: while a modal is
   * suspended, `open` stays `true`.
   */
  onOpenChange?: ((open: boolean, ...rest: Partial<Rest>) => void) | undefined;
  /** Overrides the policy priority for this instance. Reactive. */
  priority?: number | undefined;
  /** Overrides other policy fields for this instance. */
  policy?: Omit<ModalPolicyOverrides, "priority"> | undefined;
  /** Called when the scheduler dismisses this modal. `onOpenChange(false)` follows. */
  onDismiss?: ((reason: ModalDismissReason) => void) | undefined;
};

export type ManagedRootProps<P, Name extends string> = DistributiveOmit<P, "open" | "defaultOpen" | "onOpenChange"> &
  ManagedRootOwnProps<Name, OpenChangeRest<P>>;

export type ManagedOptions = {
  kind: ModalKind;
  adapter?: ModalAdapter | undefined;
  displayName?: string | undefined;
};

type AnyOpenChange = (open: boolean, ...rest: unknown[]) => void;
type AnyRootProps = ManagedRootOwnProps<string, unknown[]> & Record<string, unknown>;

let warnedOutsideProvider = false;

function warnOutsideProvider(name: string): void {
  if (warnedOutsideProvider) return;
  warnedOutsideProvider = true;
  console.warn(
    `managed-modals: modal "${name}" is rendered outside <ModalProvider>, so it is not scheduled. ` +
      "Render <ModalProvider> near the root of the app.",
  );
}

/**
 * Wraps a Dialog/Drawer root (anything with `open` + `onOpenChange`) so that
 * its `open` prop becomes a request to the scheduler.
 */
export function createManagedRoot<P extends object, Name extends string = string>(
  Root: ComponentType<P>,
  options: ManagedOptions,
): ComponentType<ManagedRootProps<P, Name>> {
  const RootComponent = Root as ComponentType<Record<string, unknown>>;

  function ScheduledRoot({ props, name, inheritedName }: { props: AnyRootProps; name: string; inheritedName: boolean }) {
    const {
      name: _name,
      open: openProp,
      defaultOpen = false,
      onOpenChange,
      priority,
      policy,
      onDismiss,
      ...rootProps
    } = props;

    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const controlled = openProp !== undefined;
    const intent = controlled ? openProp : uncontrolledOpen;

    const onOpenChangeRef = useRef(onOpenChange);
    useIsomorphicLayoutEffect(() => {
      onOpenChangeRef.current = onOpenChange;
    });

    const setIntent = useCallback(
      (next: boolean, ...rest: unknown[]) => {
        (onOpenChangeRef.current as AnyOpenChange | undefined)?.(next, ...rest);
        // Base UI lets handlers veto the change via `eventDetails.cancel()`.
        const details = rest[0] as { isCanceled?: boolean } | undefined;
        if (details?.isCanceled) return;
        if (!controlled) setUncontrolledOpen(next);
      },
      [controlled],
    );

    const modal = useManagedModal({
      name,
      open: intent,
      kind: options.kind,
      priority,
      // A name borrowed from the parent is not a second modal of that name.
      policy: inheritedName ? { ...policy, unique: false } : policy,
      onDismiss: (reason) => {
        onDismiss?.(reason);
        setIntent(false);
      },
    });

    const visible = modal.presentation.open;
    const handleOpenChange = (next: boolean, ...rest: unknown[]) => {
      // A trigger pressed while the modal is already queued.
      if (next === intent) return;
      // The primitive echoing a close that the scheduler caused, or closing a
      // modal that is hidden behind a <ModalActivity> (Base UI listens for
      // Escape and outside presses at the root, which stays open).
      if (!next && !visible) return;
      setIntent(next, ...rest);
    };

    const adapterProps = options.adapter?.getRootProps?.(modal.contextValue, rootProps) ?? {};

    return (
      <ManagedModalContext.Provider value={modal.contextValue}>
        <RootComponent {...rootProps} {...adapterProps} open={modal.rootOpen} onOpenChange={handleOpenChange} />
      </ManagedModalContext.Provider>
    );
  }

  function ManagedRoot(props: ManagedRootProps<P, Name>) {
    const store = useContext(ModalStoreContext);
    const parent = useContext(ManagedModalContext);
    const ownProps = props as unknown as AnyRootProps;
    const name = ownProps.name ?? parent?.name;

    // Not scheduled: render the primitive as if it were not wrapped. (Switching
    // between this and the scheduled root remounts it; that only happens when
    // `name` is added or removed outside a managed modal.)
    if (!store || name === undefined) {
      if (!store && ownProps.name !== undefined) warnOutsideProvider(ownProps.name);
      const { name: _name, priority: _priority, policy: _policy, onDismiss: _onDismiss, ...rootProps } = ownProps;
      return <RootComponent {...rootProps} />;
    }

    return <ScheduledRoot props={ownProps} name={name} inheritedName={ownProps.name === undefined} />;
  }

  ManagedRoot.displayName =
    options.displayName ?? `Managed(${Root.displayName ?? (Root.name || "Root")})`;

  return ManagedRoot;
}
