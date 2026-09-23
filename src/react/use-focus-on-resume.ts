"use client";

import { useEffect, useRef, type RefObject } from "react";

import { useModalPresentation } from "./context.js";
import { useIsomorphicLayoutEffect } from "./use-managed-modal.js";

/**
 * Moves focus back into kept-mounted modal content when a suspended modal
 * comes back, to the element that had focus before the suspension.
 *
 * Radix only auto-focuses content when it mounts, so a Radix dialog that
 * resumes would otherwise leave focus on `<body>`. Pass the content element.
 */
export function useFocusOnResume(ref: RefObject<HTMLElement | null>): void {
  const presentation = useModalPresentation();
  const status = presentation?.status;
  const open = presentation?.open ?? false;
  const previousStatus = useRef(status);
  const lastFocused = useRef<HTMLElement | null>(null);

  // Layout effect: attached before the primitive's own (passive) auto-focus runs.
  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const active = element.ownerDocument.activeElement;
    if (active instanceof HTMLElement && element.contains(active)) lastFocused.current = active;
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocused.current = event.target;
    };
    element.addEventListener("focusin", onFocusIn);
    return () => element.removeEventListener("focusin", onFocusIn);
  });

  useEffect(() => {
    const resumed = previousStatus.current === "suspended" && open;
    previousStatus.current = status;
    const element = ref.current;
    if (!resumed || !element || element.contains(element.ownerDocument.activeElement)) return;

    const target = lastFocused.current;
    (target?.isConnected && element.contains(target) ? target : element).focus();
  }, [ref, status, open]);
}
