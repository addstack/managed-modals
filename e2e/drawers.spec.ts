import { expect, test } from "@playwright/test";

import { dialog, expectPageReleased, expectShown, openFixture, recordWhile, setOpen } from "./fixture.js";

// Drawers next to dialogs. The dialogs use Base UI here, so that their exits
// are reported by the primitive and never wait for the timeout fallback.

for (const [drawer, content] of [
  ["vaul", "activity"],
  ["vaul", "keep-mounted"],
  ["base-ui", "activity"],
  ["base-ui", "keep-mounted"],
] as const) {
  test.describe(`${drawer} drawer, ${content}`, () => {
    test("a drawer preempted by a critical dialog comes back after it and closes cleanly", async ({ page }) => {
      await openFixture(page, { kit: "base-ui", drawer, content });
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
      test.fixme(
        drawer === "vaul" && content === "keep-mounted",
        "vaul has no way to keep a closed drawer mounted; <ModalActivity> keeps it (spec §13).",
      );
      await openFixture(page, { kit: "base-ui", drawer, content });
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
      await openFixture(page, { kit: "base-ui", drawer, content, awaitExit: true, exitTimeoutMs });
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
      test.fail(
        drawer === "vaul" && content === "keep-mounted",
        "vaul calls onAnimationEnd only for closes it started itself, so a scheduler switch waits for exitTimeoutMs. " +
          "With <ModalActivity> the drawer is hidden at once and its exit completes right away.",
      );
      const exitTimeoutMs = 3000;
      await openFixture(page, { kit: "base-ui", drawer, content, awaitExit: true, exitTimeoutMs });
      await page.getByRole("button", { name: "Open filters" }).click();
      await expectShown(page, ["Filters"]);

      const recording = await recordWhile(page, () => setOpen(page, "session-expired", true), ["Session expired"]);
      expect(recording.together("Filters", "Session expired")).toEqual([]);
      expect(recording.appearedAfter("Session expired")).toBeLessThan(exitTimeoutMs / 2);
    });
  });
}
