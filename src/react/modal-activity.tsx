"use client";

import { Activity, useContext, useId, useRef, useState, type ReactNode } from "react";

import { isDescendantOf } from "../core/index.js";
import {
  ActivityStateContext,
  ManagedModalContext,
  ModalStoreContext,
  NestedRequestsContext,
  type ActivityState,
  type NestedRequests,
} from "./context.js";
import { useIsomorphicLayoutEffect } from "./use-managed-modal.js";

/**
 * Keeps a suspended modal's content alive with React's `<Activity>`: it is
 * hidden, its effects (focus trap, scroll lock, `aria-hidden` on the page)
 * are cleaned up, and its state and DOM are kept until the modal comes back.
 * Content of a queued modal is hidden the same way, in case it renders while
 * its root is closed (Radix `forceMount`, Base UI `keepMounted`, JS animation
 * libraries).
 *
 * Wrap the portal of your content component with it, e.g. in shadcn/ui's
 * `DialogContent`. Outside a managed modal it renders its children as they are.
 */
export function ModalActivity({ children }: { children?: ReactNode }) {
  const id = useId();
  const modal = useContext(ManagedModalContext);
  const store = useContext(ModalStoreContext);
  const parentState = useContext(ActivityStateContext);
  const enabled = modal !== null && store !== null;
  const requestId = modal?.requestId ?? null;
  const register = modal?.registerActivity;
  const status = modal?.presentation.status;
  const suspended = enabled && status === "suspended";
  // Queued modals are hidden too, for content that renders while its root is
  // closed (Radix `forceMount`, Base UI `keepMounted`, JS animation libraries).
  const concealed = suspended || (enabled && status === "pending");
  // A nested modal comes back one commit after its parent (still before paint).
  // Primitives such as Radix stack layers in the order their effects register,
  // and React runs a child's effects before its parent's.
  const afterParent = enabled && !concealed && parentState === "revealing";
  const hidden = concealed || afterParent;

  // "revealing" lasts until the content's effects, nested modals included, are back.
  const [wasHidden, setWasHidden] = useState(false);
  if (hidden && !wasHidden) setWasHidden(true);
  const revealing = wasHidden && !hidden;
  useIsomorphicLayoutEffect(() => {
    if (revealing) setWasHidden(false);
  }, [revealing]);

  // Revealed after its parent: while the parent's content effects ran, this
  // content's portals were already on the page (hidden), and Radix, through
  // `aria-hidden`'s `hideOthers`, marked them as outside the parent. Opening
  // the same flow normally never does, so undo it for the portals this
  // boundary reveals now. They are the ones React hid while it was hidden.
  const afterParentRef = useRef(false);
  const hiddenPortalsRef = useRef<HTMLElement[]>([]);
  useIsomorphicLayoutEffect(() => {
    if (!hidden) return;
    afterParentRef.current = afterParent;
    hiddenPortalsRef.current = portalsHiddenByReact(document);
  });
  useIsomorphicLayoutEffect(() => {
    if (!revealing || !afterParentRef.current) return;
    for (const portal of hiddenPortalsRef.current) {
      if (!isHiddenByReact(portal) && portal.getAttribute("aria-hidden") === "true" && portal.hasAttribute("data-aria-hidden")) {
        portal.removeAttribute("aria-hidden");
      }
    }
    afterParentRef.current = false;
    hiddenPortalsRef.current = [];
  }, [revealing]);

  // Nested modals keep their requests while hidden with this modal's flow.
  // When the content is back, those that did not take theirs over again were
  // removed or closed while hidden: their requests are dropped, so that
  // nothing that is gone stays in the queue.
  const requestIdRef = useRef(requestId);
  const [nested] = useState(() => {
    const adopted = new Set<string>();
    const registry: NestedRequests = {
      hiding: () => {
        const own = requestIdRef.current;
        return own !== null && store !== null && store.getPresentation(own).status === "suspended";
      },
      adopt: (nestedRequestId) => adopted.add(nestedRequestId),
      reclaim: (nestedRequestId) => adopted.delete(nestedRequestId),
    };
    const dropUnclaimed = () => {
      for (const nestedRequestId of adopted) store?.cancel(nestedRequestId);
      adopted.clear();
    };
    return { registry, dropUnclaimed };
  });
  useIsomorphicLayoutEffect(() => {
    requestIdRef.current = requestId;
  });
  // Runs after the effects of the revealed content, where nested modals take their requests back.
  useIsomorphicLayoutEffect(() => {
    if (revealing) nested.dropUnclaimed();
  }, [revealing, nested]);
  useIsomorphicLayoutEffect(() => nested.dropUnclaimed, [nested]);

  useIsomorphicLayoutEffect(() => (enabled && register ? register(id) : undefined), [enabled, register, id]);

  useIsomorphicLayoutEffect(() => {
    if (!suspended || requestId === null || !store) return;
    // Hidden at once, without an exit animation: finish the exit of this
    // modal and of the nested modals hidden with it.
    for (const exitingId of store.getSnapshot().exiting) {
      if (exitingId === requestId || isDescendantOf(store.getSnapshot(), exitingId, requestId)) {
        store.exitComplete(exitingId);
      }
    }
  }, [suspended, requestId, store]);

  if (!enabled) return children;

  const state: ActivityState =
    hidden || parentState === "hidden" ? "hidden" : revealing || parentState === "revealing" ? "revealing" : "visible";
  return (
    <Activity mode={hidden ? "hidden" : "visible"}>
      <ActivityStateContext.Provider value={state}>
        <NestedRequestsContext.Provider value={nested.registry}>{children}</NestedRequestsContext.Provider>
      </ActivityStateContext.Provider>
    </Activity>
  );
}

/** React hides the content of a hidden `<Activity>` with `display: none !important`. */
function isHiddenByReact(element: HTMLElement): boolean {
  return element.style.getPropertyValue("display") === "none" && element.style.getPropertyPriority("display") === "important";
}

function portalsHiddenByReact(doc: Document): HTMLElement[] {
  return Array.from(doc.body.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && isHiddenByReact(child),
  );
}
