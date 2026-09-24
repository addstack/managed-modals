// @vitest-environment jsdom
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, test } from "vitest";

import { adapters, createManagedModals, ModalActivity } from "../src/react/index.js";

// Base UI detached triggers: `Dialog.createHandle()`, and `<Dialog.Trigger handle>`
// rendered outside the root, optionally with a payload for the root's content.

afterEach(cleanup);

const policies = {
  "session-expired": { priority: 100 },
  "edit-user": { priority: 40 },
} as const;

type User = { name: string };
type RootProps = {
  name: "edit-user" | "session-expired";
  handle?: BaseDialog.Handle<User>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode | ((arg: { payload: User | undefined }) => ReactNode);
};

function setup() {
  const modals = createManagedModals({ policies });
  const Root = modals.managed(BaseDialog.Root, { kind: "dialog", adapter: adapters.baseUi }) as unknown as ComponentType<RootProps>;
  return { ...modals, Root };
}

function Content({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <ModalActivity>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop />
        <BaseDialog.Popup>
          <BaseDialog.Title>{title}</BaseDialog.Title>
          {children}
          <BaseDialog.Close>Close {title}</BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </ModalActivity>
  );
}

function visibleDialogs(): string[] {
  return screen
    .queryAllByRole("dialog", { hidden: true })
    .filter((dialog) => !dialog.closest('[hidden], [style*="display: none"]'))
    .map((dialog) => dialog.querySelector("h2")?.textContent ?? "?");
}

describe("detached triggers", () => {
  function App({ handle, onSession }: { handle: BaseDialog.Handle<User>; onSession: (set: (open: boolean) => void) => void }) {
    const { ModalProvider, Root } = shared;
    const [session, setSession] = useState(false);
    onSession(setSession);
    return (
      <ModalProvider>
        <BaseDialog.Trigger handle={handle} payload={{ name: "Ada" }}>
          Edit Ada
        </BaseDialog.Trigger>
        <BaseDialog.Trigger handle={handle} payload={{ name: "Grace" }}>
          Edit Grace
        </BaseDialog.Trigger>
        <Root name="edit-user" handle={handle}>
          {({ payload }) => (
            <Content title={`Edit ${payload?.name ?? "nobody"}`}>
              <input aria-label="Note" />
            </Content>
          )}
        </Root>
        <Root name="session-expired" open={session} onOpenChange={setSession}>
          <Content title="Session expired" />
        </Root>
      </ModalProvider>
    );
  }
  const shared = setup();

  test("a trigger outside the root opens the managed dialog with its payload, and focus goes back to it", async () => {
    const handle = BaseDialog.createHandle<User>();
    render(<App handle={handle} onSession={() => {}} />);

    fireEvent.click(screen.getByText("Edit Grace"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit Grace"]));
    expect(handle.isOpen).toBe(true);

    fireEvent.click(screen.getByText("Close Edit Grace"));
    await waitFor(() => expect(visibleDialogs()).toEqual([]));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Edit Grace")));
  });

  test("opening through the handle while a higher priority is on screen queues the dialog", async () => {
    const handle = BaseDialog.createHandle<User>();
    let setSession!: (open: boolean) => void;
    render(<App handle={handle} onSession={(set) => (setSession = set)} />);

    act(() => setSession(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));
    act(() => handle.openWithPayload({ name: "Ada" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(visibleDialogs()).toEqual(["Session expired"]);

    act(() => setSession(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit Ada"]));

    act(() => handle.close());
    await waitFor(() => expect(visibleDialogs()).toEqual([]));
  });

  test("a preempted dialog opened from a detached trigger comes back with its payload and state", async () => {
    const handle = BaseDialog.createHandle<User>();
    let setSession!: (open: boolean) => void;
    render(<App handle={handle} onSession={(set) => (setSession = set)} />);

    fireEvent.click(screen.getByText("Edit Grace"));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit Grace"]));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "promote" } });

    act(() => setSession(true));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Session expired"]));
    act(() => setSession(false));
    await waitFor(() => expect(visibleDialogs()).toEqual(["Edit Grace"]));
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("promote");
  });
});
