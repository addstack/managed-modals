// @vitest-environment node
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { adapters, createManagedModals, ModalActivity } from "../src/react/index.js";

// On the server there is no store subscription yet: managed modals render closed
// and open after hydration, with the one-line <ModalActivity> integration in place.

const modals = createManagedModals({ policies: { onboarding: { priority: 10 } } });
const RadixManaged = modals.managed(RadixDialog.Root, { kind: "dialog", adapter: adapters.radix });
const BaseManaged = modals.managed((props: ComponentProps<typeof BaseDialog.Root>) => <BaseDialog.Root {...props} />, {
  kind: "dialog",
  adapter: adapters.baseUi,
});

test("an open managed modal renders closed on the server, without errors", () => {
  const error = vi.spyOn(console, "error");
  const html = renderToString(
    <modals.ModalProvider>
      <RadixManaged name="onboarding" defaultOpen>
        <RadixDialog.Trigger>Open Radix</RadixDialog.Trigger>
        <ModalActivity>
          <RadixDialog.Portal>
            <RadixDialog.Content aria-describedby={undefined}>
              <RadixDialog.Title>Radix content</RadixDialog.Title>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </ModalActivity>
      </RadixManaged>
      <BaseManaged name="onboarding" defaultOpen>
        <BaseDialog.Trigger>Open Base UI</BaseDialog.Trigger>
        <ModalActivity>
          <BaseDialog.Portal>
            <BaseDialog.Popup>
              <BaseDialog.Title>Base UI content</BaseDialog.Title>
            </BaseDialog.Popup>
          </BaseDialog.Portal>
        </ModalActivity>
      </BaseManaged>
    </modals.ModalProvider>,
  );

  expect(html).toContain("Open Radix");
  expect(html).toContain("Open Base UI");
  expect(html).not.toContain("Radix content");
  expect(html).not.toContain("Base UI content");
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});
