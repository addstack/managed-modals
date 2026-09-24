"use client";

import { useRef, type RefObject } from "react";

import { useModalPresentation } from "./context.js";
import { useIsomorphicLayoutEffect } from "./use-managed-modal.js";

/**
 * Pauses a `<video>` or `<audio>` while its modal is suspended, and plays it
 * again from the same point when the modal comes back, if it was playing.
 *
 * Hidden media keeps playing (and is heard) unless something pauses it. Works
 * with both `<ModalActivity>` and the `keepMounted` integration.
 */
export function usePauseWhileSuspended(ref: RefObject<HTMLMediaElement | null>): void {
  const suspended = useModalPresentation()?.status === "suspended";
  const resume = useRef(false);

  useIsomorphicLayoutEffect(() => {
    const media = ref.current;
    if (!media || suspended) return;
    if (resume.current) {
      resume.current = false;
      Promise.resolve(media.play()).catch(() => {});
    }
    // Runs when the modal is suspended, and when a <ModalActivity> hides the content.
    return () => {
      if (media.paused) return;
      resume.current = true;
      media.pause();
    };
  }, [ref, suspended]);
}
