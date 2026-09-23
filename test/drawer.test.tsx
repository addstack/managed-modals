// @vitest-environment jsdom
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import * as RadixDialog from "@radix-ui/react-dialog";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { Drawer as VaulDrawer } from "vaul";
import { afterEach, beforeAll, expect, test } from "vitest";

import { adapters, createManagedModals } from "../src/react/index.js";

beforeAll(() => {
  // vaul reads these; jsdom does not implement them.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(cleanup);

const modals = createManagedModals({
  policies: { "session-expired": { priority: 100 }, filters: { priority: 10 } },
});
const Dialog = modals.managed(RadixDialog.Root, { kind: "dialog", adapter: adapters.radix });
const VaulManaged = modals.managed(VaulDrawer.Root, { kind: "drawer", adapter: adapters.vaul });
const BaseDrawerManaged = modals.managed(
  (props: ComponentProps<typeof BaseDrawer.Root>) => <BaseDrawer.Root {...props} />,
  { kind: "drawer", adapter: adapters.baseUi },
);

function visible(): string[] {
  return screen
    .queryAllByRole("dialog", { hidden: true })
    .filter((element) => !element.closest("[hidden]"))
    .map((element) => element.querySelector("h2")?.textContent ?? "?");
}

test("a vaul drawer waits for a higher-priority dialog and opens after it closes", async () => {
  let setSession!: (open: boolean) => void;
  function App() {
    const [session, setSessionState] = useState(true);
    setSession = setSessionState;
    return (
      <modals.ModalProvider>
        <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
          <RadixDialog.Portal>
            <RadixDialog.Content aria-describedby={undefined}>
              <RadixDialog.Title>Session expired</RadixDialog.Title>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </Dialog>
        <VaulManaged name="filters" defaultOpen>
          <VaulDrawer.Portal>
            <VaulDrawer.Content aria-describedby={undefined}>
              <VaulDrawer.Title>Filters</VaulDrawer.Title>
            </VaulDrawer.Content>
          </VaulDrawer.Portal>
        </VaulManaged>
      </modals.ModalProvider>
    );
  }

  render(<App />);
  expect(visible()).toEqual(["Session expired"]);

  act(() => setSession(false));
  await waitFor(() => expect(visible()).toEqual(["Filters"]));
});

test("a Base UI drawer opens from its trigger and is preempted by a critical dialog", async () => {
  let setSession!: (open: boolean) => void;
  function App() {
    const [session, setSessionState] = useState(false);
    setSession = setSessionState;
    return (
      <modals.ModalProvider>
        <BaseDrawerManaged name="filters">
          <BaseDrawer.Trigger>Open filters</BaseDrawer.Trigger>
          <BaseDrawer.Portal>
            <BaseDrawer.Popup>
              <BaseDrawer.Title>Filters</BaseDrawer.Title>
            </BaseDrawer.Popup>
          </BaseDrawer.Portal>
        </BaseDrawerManaged>
        <Dialog name="session-expired" open={session} onOpenChange={setSessionState}>
          <RadixDialog.Portal>
            <RadixDialog.Content aria-describedby={undefined}>
              <RadixDialog.Title>Session expired</RadixDialog.Title>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </Dialog>
      </modals.ModalProvider>
    );
  }

  render(<App />);
  fireEvent.click(screen.getByText("Open filters"));
  await waitFor(() => expect(visible()).toEqual(["Filters"]));

  act(() => setSession(true));
  await waitFor(() => expect(visible()).toEqual(["Session expired"]));

  act(() => setSession(false));
  await waitFor(() => expect(visible()).toEqual(["Filters"]));
});

test("types: vaul's snap point props keep their constraint", () => {
  const withFade = <VaulManaged name="filters" snapPoints={[0.5, 1]} fadeFromIndex={0} />;
  // @ts-expect-error `fadeFromIndex` needs `snapPoints`, as on vaul's own Drawer
  const withoutSnapPoints = <VaulManaged name="filters" fadeFromIndex={0} />;
  expect([withFade, withoutSnapPoints]).toHaveLength(2);
});
