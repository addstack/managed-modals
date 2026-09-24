import { expect, test } from "@playwright/test";

import { dialog, expectPageReleased, expectShown, openFixture, recordWhile, setOpen } from "./fixture.js";

// Drawers next to dialogs. The dialogs use Base UI here, so that their exits
// are reported by the primitive and never wait for the timeout fallback.

for (const drawer of ["vaul", "base-ui"] as const) {
  test.describe(`${drawer} drawer`, () => {
    test("a drawer preempted by a critical dialog comes back after it and closes cleanly", async ({ page }) => {
      await openFixture(page, { kit: "base-ui", drawer });
      await page.getByRole("button", { name: "Open filters" }).click();
      await expectShown(page, ["Filters"]);

      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);

      await page.keyboard.press("Escape");
      await expectShown(page, ["Filters"]);

      await dialog(page, "Filters").getByRole("button", { name: "Close" }).click();
      await expectShown(page, []);
      await expectPageReleased(page);
    });

    test("a suspended drawer keeps what was typed", async ({ page }) => {
      await openFixture(page, { kit: "base-ui", drawer });
      await page.getByRole("button", { name: "Open filters" }).click();
      await page.getByLabel("Search").fill("red shoes");

      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);
      await page.keyboard.press("Escape");
      await expectShown(page, ["Filters"]);
      await expect(page.getByLabel("Search")).toHaveValue("red shoes");
    });

    test("with awaitExit a queued dialog enters once the user-closed drawer has slid out", async ({ page }) => {
      const exitTimeoutMs = 3000;
      await openFixture(page, { kit: "base-ui", drawer, awaitExit: true, exitTimeoutMs });
      await page.getByRole("button", { name: "Open filters" }).click();
      await expectShown(page, ["Filters"]);
      await setOpen(page, "onboarding", true);

      const recording = await recordWhile(
        page,
        () => dialog(page, "Filters").getByRole("button", { name: "Close" }).click(),
        ["Onboarding"],
      );
      expect(recording.together("Filters", "Onboarding")).toEqual([]);
      // The drawer reported the end of its exit animation; the timeout fallback was not needed.
      expect(recording.appearedAfter("Onboarding")).toBeLessThan(exitTimeoutMs / 2);
    });

    test("with awaitExit a critical dialog enters once the preempted drawer has slid out", async ({ page }) => {
      const exitTimeoutMs = 3000;
      await openFixture(page, { kit: "base-ui", drawer, awaitExit: true, exitTimeoutMs });
      await page.getByRole("button", { name: "Open filters" }).click();
      await expectShown(page, ["Filters"]);

      const recording = await recordWhile(page, () => setOpen(page, "session-expired", true), ["Session expired"]);
      expect(recording.together("Filters", "Session expired")).toEqual([]);
      expect(recording.appearedAfter("Session expired")).toBeLessThan(exitTimeoutMs / 2);
    });
  });
}

// A dialog inside a drawer, with primitives from one family, as a shadcn/ui
// project has them: Radix dialogs with the vaul drawer, or Base UI for both.
for (const [kit, drawer] of [
  ["radix", "vaul"],
  ["base-ui", "base-ui"],
] as const) {
  test(`${drawer} drawer with a ${kit} dialog inside: the pair is preempted and comes back whole`, async ({ page }) => {
    await openFixture(page, { kit, drawer });
    await page.getByRole("button", { name: "Open filters" }).click();
    await expectShown(page, ["Filters"]);
    await page.getByLabel("Search").fill("red shoes");
    await dialog(page, "Filters").getByRole("button", { name: "Save filter" }).click();
    await expectShown(page, ["Filters", "Save filter"]);
    await page.getByLabel("Filter name").fill("Red");

    await setOpen(page, "session-expired", true);
    await expectShown(page, ["Session expired"]);
    // Both stay known to the scheduler while hidden.
    expect(await page.evaluate(() => window.e2e.debug().length)).toBe(3);

    await page.keyboard.press("Escape");
    await expectShown(page, ["Filters", "Save filter"]);
    await expect(page.getByLabel("Filter name")).toHaveValue("Red");
    await expect(page.getByLabel("Search")).toHaveValue("red shoes");
    await expect(page.getByRole("dialog", { name: "Save filter" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expectShown(page, ["Filters"]);
  });
}
