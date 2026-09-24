import { expect, test } from "@playwright/test";

import {
  appEvents,
  clickWhereShown,
  dialog,
  expectFocusIn,
  expectPageReleased,
  expectShown,
  focusedDialog,
  openFixture,
  recordWhile,
  setOpen,
  settle,
} from "./fixture.js";

// Real-browser focus, keyboard and pointer behaviour of managed dialogs, with
// the content integration from the README. Scheduling order itself is covered
// by the unit tests in test/.

for (const kit of ["radix", "base-ui"] as const) {
  test.describe(`${kit} dialogs`, () => {
    test.beforeEach(async ({ page }) => {
      await openFixture(page, { kit });
    });

    test("a preempted dialog keeps its fields and gets focus back when it resumes", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await expectShown(page, ["Edit user"]);
      await page.getByLabel("Name").fill("Ada");
      await page.getByLabel("Email").fill("ada@example.com");

      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);
      await expectFocusIn(page, "Session expired");

      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user"]);
      await expect(page.getByLabel("Name")).toHaveValue("Ada");
      await expect(page.getByLabel("Email")).toHaveValue("ada@example.com");
      // The primitive focuses the dialog's initial focus target again, as on open: its first field.
      await expect(page.getByLabel("Name")).toBeFocused();

      // The suspension was invisible to the application: no onOpenChange(false) for "Edit user".
      expect(await appEvents(page)).toEqual([
        { type: "open-change", name: "edit-user", open: true },
        { type: "open-change", name: "session-expired", open: false },
      ]);
    });

    test("a resumed dialog can be used with the mouse", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);
      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user"]);

      await clickWhereShown(page, page.getByLabel("Name"));
      await expect(page.getByLabel("Name")).toBeFocused();
      await expectShown(page, ["Edit user"]);
    });

    test("closing the last dialog after a suspension returns focus to its trigger and releases the page", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);
      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user"]);

      await settle(page);
      await page.keyboard.press("Escape");
      await expectShown(page, []);
      await expect(page.getByRole("button", { name: "Edit user" })).toBeFocused();
      await expectPageReleased(page);
    });

    test("Tab stays inside the active dialog and never reaches the suspended one", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await setOpen(page, "session-expired", true);
      await expectFocusIn(page, "Session expired");

      // Every element that receives focus. Base UI wraps around through focus guards
      // outside the dialog, so focus may pass through them briefly.
      await page.evaluate(() => {
        const log: (string | null)[] = [];
        document.addEventListener("focusin", (event) => {
          const target = event.target as Element;
          log.push(target.closest('[role="dialog"]')?.querySelector("h2")?.textContent ?? null);
        });
        Object.assign(window, { focusLog: log });
      });

      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        await expectFocusIn(page, "Session expired");
      }
      const focusLog = await page.evaluate(() => (window as unknown as { focusLog: (string | null)[] }).focusLog);
      expect(focusLog).not.toContain("Edit user");
    });

    test("Escape closes a nested dialog first and focus goes back to its trigger in the parent", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await dialog(page, "Edit user").getByRole("button", { name: "Delete user" }).click();
      await expectShown(page, ["Edit user", "Really delete?"]);
      await expectFocusIn(page, "Really delete?");

      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user"]);
      await expect(page.getByRole("button", { name: "Delete user" })).toBeFocused();

      await page.keyboard.press("Escape");
      await expectShown(page, []);
      await expect(page.getByRole("button", { name: "Edit user" })).toBeFocused();
    });

    test("clicking outside a nested dialog closes only that dialog", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await dialog(page, "Edit user").getByRole("button", { name: "Delete user" }).click();
      await expectShown(page, ["Edit user", "Really delete?"]);

      await page.mouse.click(10, 10);
      await expectShown(page, ["Edit user"]);
    });

    test("a preempted nested flow comes back whole, with the nested dialog on top", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await dialog(page, "Edit user").getByRole("button", { name: "Delete user" }).click();
      await expectShown(page, ["Edit user", "Really delete?"]);

      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);

      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user", "Really delete?"]);

      await settle(page);
      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user"]);
    });

    test("a nested dialog without a name is hidden and brought back with its parent's flow", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await dialog(page, "Edit user").getByRole("button", { name: "Discard changes" }).click();
      await expectShown(page, ["Edit user", "Discard changes?"]);

      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);
      await expectFocusIn(page, "Session expired");

      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user", "Discard changes?"]);

      await settle(page);
      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user"]);
      expect(await appEvents(page)).toEqual([
        { type: "open-change", name: "edit-user", open: true },
        { type: "open-change", name: "discard-changes", open: true },
        { type: "open-change", name: "session-expired", open: false },
        { type: "open-change", name: "discard-changes", open: false },
      ]);
    });

    test("focus goes to the nested dialog on top when a preempted nested flow comes back", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await dialog(page, "Edit user").getByRole("button", { name: "Delete user" }).click();
      await expectShown(page, ["Edit user", "Really delete?"]);
      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);

      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user", "Really delete?"]);
      await expect.poll(() => focusedDialog(page), { timeout: 2000 }).toBe("Really delete?");
    });

    test("a suspended dialog keeps its scroll position", async ({ page }) => {
      await setOpen(page, "billing", true);
      await expectShown(page, ["Billing"]);
      const terms = page.getByRole("region", { name: "Payment terms" });
      // As a user scrolls: the scroll has happened (and its event fired) before anything else.
      await terms.evaluate(
        (element) =>
          new Promise<void>((resolve) => {
            element.addEventListener("scroll", () => resolve(), { once: true });
            element.scrollTo(0, 200);
          }),
      );

      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);
      await page.keyboard.press("Escape");
      await expectShown(page, ["Billing"]);
      // Within a pixel: Firefox reports fractional positions.
      expect(await terms.evaluate((element) => element.scrollTop)).toBeCloseTo(200, -0.3);
    });

    test("a suspended dialog that the application closes never shows up again, not even while it animates out", async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await expectShown(page, ["Edit user"]);
      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);

      const recording = await recordWhile(page, () => setOpen(page, "edit-user", false), ["Session expired"]);
      await page.waitForTimeout(500);
      expect(recording.together("Edit user")).toEqual([]);
      await expectShown(page, ["Session expired"]);
    });

    test("a resumed nested flow exposes the nested dialog to assistive technology, not its parent", async ({ page }) => {
      await page.getByRole("button", { name: "Edit user" }).click();
      await dialog(page, "Edit user").getByRole("button", { name: "Delete user" }).click();
      await expectShown(page, ["Edit user", "Really delete?"]);
      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);

      await page.keyboard.press("Escape");
      await expectShown(page, ["Edit user", "Really delete?"]);
      await expect(page.getByRole("dialog", { name: "Really delete?" })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Edit user" })).toHaveCount(0);
    });

    test('a dialog dismissed by preemption ("onPreempt: dismiss") does not pull focus back to its trigger', async ({
      page,
    }) => {
      await page.getByRole("button", { name: "Start onboarding" }).click();
      await expectShown(page, ["Onboarding"]);

      await setOpen(page, "session-expired", true);
      await expectShown(page, ["Session expired"]);
      // Wait until the dismissed content is gone: that is when primitives restore focus.
      await expect(dialog(page, "Onboarding")).toHaveCount(0);
      await expectFocusIn(page, "Session expired");
      expect(await appEvents(page)).toEqual([
        { type: "open-change", name: "onboarding", open: true },
        { type: "dismiss", name: "onboarding", reason: "preempted" },
        { type: "open-change", name: "onboarding", open: false },
      ]);

      await page.keyboard.press("Escape");
      await expectShown(page, []);
    });
  });
}

test.describe("Base UI detached trigger", () => {
  test("a trigger outside the root opens the managed dialog; after a preemption, closing returns focus to it", async ({
    page,
  }) => {
    await openFixture(page, { kit: "base-ui" });
    await page.getByRole("button", { name: "Open user editor" }).click();
    await expectShown(page, ["Edit user"]);
    await page.getByLabel("Name").fill("Ada");

    await setOpen(page, "session-expired", true);
    await expectShown(page, ["Session expired"]);
    await page.keyboard.press("Escape");
    await expectShown(page, ["Edit user"]);
    await expect(page.getByLabel("Name")).toHaveValue("Ada");

    await settle(page);
    await page.keyboard.press("Escape");
    await expectShown(page, []);
    await expect(page.getByRole("button", { name: "Open user editor" })).toBeFocused();
    await expectPageReleased(page);
  });
});
