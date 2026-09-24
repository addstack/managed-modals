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
  // Where playback stopped, while it is to be resumed.
  const resumeAt = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const media = ref.current;
    if (!media || suspended) return;
    const time = resumeAt.current;
    const resume = time === null ? undefined : resumeFrom(media, time);
    resumeAt.current = null;
    // Runs when the modal is suspended, and when a <ModalActivity> hides the content.
    return () => {
      // Cleaned up before playback started again (Strict Mode runs effects
      // twice): keep the position for the next run.
      if (resume && !resume.cancel()) {
        resumeAt.current = time;
        return;
      }
      if (media.paused) return;
      media.pause();
      resumeAt.current = media.currentTime;
    };
  }, [ref, suspended]);
}

/**
 * Seeks to `time`, then plays. The seek makes engines that tore down their
 * playback of hidden media (WebKit with GStreamer) set it up again at that
 * point instead of starting over.
 */
function resumeFrom(media: HTMLMediaElement, time: number): { cancel(): boolean } {
  let played = false;
  const play = () => {
    if (played) return;
    played = true;
    media.removeEventListener("seeked", play);
    clearTimeout(fallback);
    Promise.resolve(media.play()).catch(() => {});
  };
  media.addEventListener("seeked", play);
  // Engines that do not seek to the position they are already at.
  const fallback = setTimeout(play, 300);
  const release = holdPosition(media, time);
  return {
    /** Stops resuming. Returns whether playback had started again. */
    cancel() {
      media.removeEventListener("seeked", play);
      clearTimeout(fallback);
      release();
      return played;
    },
  };
}

/**
 * Seeks to `time` and keeps playback from starting over after a resume. Some
 * engines drop the position of paused media that was hidden, a moment after
 * it plays again (WebKit with GStreamer restarts from 0). Watches until
 * playback has moved on from `time`, the user seeks, or 3 seconds have passed.
 */
function holdPosition(media: HTMLMediaElement, time: number): () => void {
  let seekingBack = false;
  const seek = () => {
    seekingBack = true;
    media.currentTime = time;
  };
  const putBack = () => {
    if (media.currentTime < time - 0.25) seek();
  };
  const onTimeUpdate = () => {
    if (media.currentTime >= time + 0.5) release();
    else putBack();
  };
  const onSeeking = () => {
    // A seek of the user's own: leave it alone.
    if (!seekingBack) release();
  };
  const onSeeked = () => {
    seekingBack = false;
  };
  const listeners: [string, () => void][] = [
    ["waiting", putBack],
    ["loadedmetadata", putBack],
    ["timeupdate", onTimeUpdate],
    ["seeking", onSeeking],
    ["seeked", onSeeked],
  ];
  const timer = setTimeout(release, 3000);
  for (const [type, listener] of listeners) media.addEventListener(type, listener);

  function release() {
    clearTimeout(timer);
    for (const [type, listener] of listeners) media.removeEventListener(type, listener);
  }

  seek();
  return release;
}
