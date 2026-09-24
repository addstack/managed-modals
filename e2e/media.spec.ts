import { expect, test, type Page } from "@playwright/test";

import { dialog, expectShown, openFixture, setOpen } from "./fixture.js";

// A video playing in a dialog that gets preempted. Hidden media keeps playing
// (and would be heard) unless something pauses it: `usePauseWhileSuspended`.

async function video(page: Page): Promise<{ time: number; paused: boolean }> {
  return page.locator("video").evaluate((element: HTMLVideoElement) => ({
    time: element.currentTime,
    paused: element.paused,
  }));
}

for (const kit of ["radix", "base-ui"] as const) {
  test(`${kit}: a playing video pauses while its dialog is preempted and plays on from the same point`, async ({
    page,
  }) => {
    await openFixture(page, { kit });
    await page.getByRole("button", { name: "Watch intro" }).click();
    await expectShown(page, ["Intro video"]);
    await dialog(page, "Intro video").getByRole("button", { name: "Play video" }).click();
    await expect.poll(async () => (await video(page)).time, { message: "video playing" }).toBeGreaterThan(1.5);

    await setOpen(page, "session-expired", true);
    await expectShown(page, ["Session expired"]);
    const suspended = await video(page);
    expect(suspended.paused).toBe(true);
    // Not playing on behind the other dialog.
    await page.waitForTimeout(800);
    expect((await video(page)).time).toBe(suspended.time);

    await page.keyboard.press("Escape");
    await expectShown(page, ["Intro video"]);
    const resumed = await video(page);
    // Same element, same point: not reset to the start.
    expect(resumed.time).toBeGreaterThanOrEqual(suspended.time);
    expect(resumed.time).toBeLessThan(suspended.time + 1);
    await expect
      .poll(async () => (await video(page)).time, { message: "video playing again" })
      .toBeGreaterThan(suspended.time + 0.5);
  });
}
