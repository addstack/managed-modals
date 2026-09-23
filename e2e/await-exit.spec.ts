import { expect, test, type Page } from "@playwright/test";

import { defaultOptions, dialog, expectShown, openFixture, recordWhile, setOpen } from "./fixture.js";

// Exit animations with real CSS: which dialogs are on screen is sampled on
// every animation frame while one dialog replaces another.

const { durationMs } = defaultOptions;

async function queueOnboardingBehindBilling(page: Page): Promise<void> {
  await setOpen(page, "billing", true);
  await setOpen(page, "onboarding", true);
  await expectShown(page, ["Billing"]);
}

test.describe("without awaitExit", () => {
  for (const kit of ["radix", "base-ui"] as const) {
    test(`${kit}: the next dialog enters while the previous one is still animating out`, async ({ page }) => {
      await openFixture(page, { kit });
      await queueOnboardingBehindBilling(page);

      const recording = await recordWhile(
        page,
        () => dialog(page, "Billing").getByRole("button", { name: "Close" }).click(),
        ["Onboarding"],
      );
      expect(recording.together("Billing", "Onboarding")).not.toHaveLength(0);
    });
  }
});

test.describe("with awaitExit", () => {
  test("base-ui: the next dialog enters once the previous one has animated out, as reported by Base UI", async ({
    page,
  }) => {
    const exitTimeoutMs = 10_000;
    await openFixture(page, { kit: "base-ui", awaitExit: true, exitTimeoutMs });
    await queueOnboardingBehindBilling(page);

    const recording = await recordWhile(
      page,
      () => dialog(page, "Billing").getByRole("button", { name: "Close" }).click(),
      ["Onboarding"],
    );
    expect(recording.together("Billing", "Onboarding")).toEqual([]);
    expect(recording.appearedAfter("Onboarding")).toBeGreaterThanOrEqual(durationMs * 0.8);
    // Reported by onOpenChangeComplete, long before the timeout fallback.
    expect(recording.appearedAfter("Onboarding")).toBeLessThan(exitTimeoutMs / 4);
  });

  test("radix: without an exit callback the next dialog waits for exitTimeoutMs", async ({ page }) => {
    const exitTimeoutMs = 800;
    await openFixture(page, { kit: "radix", awaitExit: true, exitTimeoutMs });
    await queueOnboardingBehindBilling(page);

    const recording = await recordWhile(
      page,
      () => dialog(page, "Billing").getByRole("button", { name: "Close" }).click(),
      ["Onboarding"],
    );
    expect(recording.together("Billing", "Onboarding")).toEqual([]);
    expect(recording.appearedAfter("Onboarding")).toBeGreaterThanOrEqual(exitTimeoutMs);
  });

  for (const kit of ["radix", "base-ui"] as const) {
    test(`${kit}: preemption and resume never show both flows at once`, async ({ page }) => {
      await openFixture(page, { kit, awaitExit: true, exitTimeoutMs: 800 });
      await page.getByRole("button", { name: "Edit user" }).click();
      await expectShown(page, ["Edit user"]);

      const preemption = await recordWhile(page, () => setOpen(page, "session-expired", true), ["Session expired"]);
      expect(preemption.together("Edit user", "Session expired")).toEqual([]);

      const resume = await recordWhile(page, () => page.keyboard.press("Escape"), ["Edit user"]);
      expect(resume.together("Edit user", "Session expired")).toEqual([]);
    });

    test(`${kit}: a nested dialog opens and closes over its parent without waiting or hiding it`, async ({ page }) => {
      const exitTimeoutMs = 10_000;
      await openFixture(page, { kit, awaitExit: true, exitTimeoutMs });
      await page.getByRole("button", { name: "Edit user" }).click();
      await expectShown(page, ["Edit user"]);

      const opening = await recordWhile(
        page,
        () => dialog(page, "Edit user").getByRole("button", { name: "Delete user" }).click(),
        ["Edit user", "Really delete?"],
      );
      expect(opening.appearedAfter("Really delete?")).toBeLessThan(exitTimeoutMs / 4);
      expect(opening.together("Edit user")).toHaveLength(opening.frames.length);

      // The nested dialog's exit is still running while its parent becomes active again.
      const closing = await recordWhile(page, () => page.keyboard.press("Escape"), ["Edit user"]);
      expect(closing.together("Edit user")).toHaveLength(closing.frames.length);
    });
  }
});
