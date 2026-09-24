import { expect, type Locator, type Page } from "@playwright/test";

import type { Frame, HarnessEvent } from "./app/harness.js";
import { defaultOptions, toSearch, type FixtureOptions } from "./app/options.js";

export { defaultOptions };

/** Loads the fixture app (e2e/app) with the given primitives and scheduler options. */
export async function openFixture(page: Page, options: Partial<FixtureOptions> = {}): Promise<void> {
  await page.goto(`/?${toSearch(options)}`);
  await expect(page.getByRole("heading", { name: "managed-modals fixture" })).toBeVisible();
}

/** Changes a modal's intent the way application state would, not through a user action. */
export async function setOpen(page: Page, name: string, open: boolean): Promise<void> {
  await page.evaluate(([name, open]) => window.e2e.setOpen(name, open), [name, open] as const);
}

/** Titles of the dialogs and drawers a user can see, in DOM order. */
export function shownDialogs(page: Page): Promise<string[]> {
  return page.evaluate(() => window.e2e.shownDialogs());
}

export async function expectShown(page: Page, titles: string[]): Promise<void> {
  await expect.poll(() => shownDialogs(page), { message: "dialogs on screen" }).toEqual(titles);
}

/** Title of the dialog that holds focus, or `null` when focus is outside every dialog. */
export function focusedDialog(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.activeElement?.closest('[role="dialog"]')?.querySelector("h2")?.textContent ?? null,
  );
}

export async function expectFocusIn(page: Page, title: string | null): Promise<void> {
  await expect.poll(() => focusedDialog(page), { message: "dialog holding focus" }).toBe(title);
}

/** A dialog by title, also while it is aria-hidden under a nested dialog. */
export function dialog(page: Page, title: string): Locator {
  return page.getByRole("dialog", { name: title, includeHidden: true });
}

/**
 * Clicks the middle of an element like a user would: whatever is on top at that
 * point gets the click. Unlike `locator.click()`, it does not wait for an
 * overlay that covers the element to go away.
 */
export async function clickWhereShown(page: Page, locator: Locator): Promise<void> {
  // A user cannot click within the few milliseconds of an enter animation; under load a test can.
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
  const box = await locator.boundingBox();
  if (!box) throw new Error("The element is not rendered.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** `onOpenChange` and `onDismiss` calls the application received, without timestamps. */
export async function appEvents(page: Page): Promise<Omit<HarnessEvent, "t">[]> {
  const events = await page.evaluate(() => window.e2e.events);
  return events.map(({ t: _t, ...event }) => event);
}

/** Checks that the page behind the modals is usable again: clickable, scrollable, nothing inert. */
export async function expectPageReleased(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Page button" }).click();
  await expect(page.getByText("Page clicks: 1")).toBeVisible();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: "page scroll position" }).toBeGreaterThan(0);
  await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("[inert]")).toHaveCount(0);
}

export type Recording = {
  frames: Frame[];
  /** Milliseconds from the action until `title` was first on screen. */
  appearedAfter(title: string): number;
  /** Frames in which all of `titles` were on screen at once. */
  together(...titles: string[]): Frame[];
};

/**
 * Samples which dialogs are on screen on every animation frame, from right
 * before `action` until exactly `until` is on screen. Running animations
 * finish first, so that `action` starts from a settled screen.
 */
export async function recordWhile(page: Page, action: () => Promise<unknown>, until: string[]): Promise<Recording> {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
  const start = await page.evaluate(() => {
    window.e2e.startRecording();
    return performance.now();
  });
  await action();
  await expectShown(page, until);
  const frames = await page.evaluate(() => window.e2e.stopRecording());

  return {
    frames,
    appearedAfter(title) {
      const frame = frames.find((candidate) => candidate.shown.includes(title));
      if (!frame) throw new Error(`"${title}" was never on screen during the recording.`);
      return frame.t - start;
    },
    together: (...titles) => frames.filter((frame) => titles.every((title) => frame.shown.includes(title))),
  };
}
