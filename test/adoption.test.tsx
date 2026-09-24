// @vitest-environment jsdom
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import * as RadixDialog from "@radix-ui/react-dialog";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentType, type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import type { ModalKind } from "../src/core/index.js";
import { adapters, createManagedModals, ModalActivity, type ModalAdapter } from "../src/react/index.js";

// Incremental adoption: adding the library to an existing project, without
// naming any modal, must not change anything. Each scenario runs twice, on the
// plain primitives ("before") and with <ModalProvider>, roots wrapped in
// managed() and the README's content changes, but no names ("after"), and
// compares the DOM, focus, onOpenChange calls and console output step by step.

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

const policies = { billing: { priority: 80 } } as const;

type ContentProps = { title: string; children?: ReactNode };
// The harness renders every primitive through the same props; their own prop types differ.
type AnyRoot = ComponentType<any>;

type Kit = {
  label: string;
  Root: AnyRoot;
  Trigger: ComponentType<{ children?: ReactNode }>;
  kind: ModalKind;
  adapter: ModalAdapter;
  content: { plain: ComponentType<ContentProps> };
  /** The kit a dialog opened from inside this one comes from. */
  nested: () => Kit;
};

// --- content components: the shadcn/ui ones, and with the README's change -------------

function withActivity(Content: ComponentType<ContentProps>): ComponentType<ContentProps> {
  return function ActivityContent(props: ContentProps) {
    return (
      <ModalActivity>
        <Content {...props} />
      </ModalActivity>
    );
  };
}

function RadixPlain({ title, children }: ContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay />
      <RadixDialog.Content aria-describedby={undefined}>
        <RadixDialog.Title>{title}</RadixDialog.Title>
        {children}
        <RadixDialog.Close>Close {title}</RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

function RadixAlertPlain({ title, children }: ContentProps) {
  return (
    <RadixAlertDialog.Portal>
      <RadixAlertDialog.Overlay />
      <RadixAlertDialog.Content aria-describedby={undefined}>
        <RadixAlertDialog.Title>{title}</RadixAlertDialog.Title>
        {children}
        <RadixAlertDialog.Cancel>Close {title}</RadixAlertDialog.Cancel>
      </RadixAlertDialog.Content>
    </RadixAlertDialog.Portal>
  );
}

function BasePlain({ title, children }: ContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop />
      <BaseDialog.Popup>
        <BaseDialog.Title>{title}</BaseDialog.Title>
        {children}
        <BaseDialog.Close>Close {title}</BaseDialog.Close>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

function BaseAlertPlain({ title, children }: ContentProps) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop />
      <BaseAlertDialog.Popup>
        <BaseAlertDialog.Title>{title}</BaseAlertDialog.Title>
        {children}
        <BaseAlertDialog.Close>Close {title}</BaseAlertDialog.Close>
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  );
}

function BaseDrawerPlain({ title, children }: ContentProps) {
  return (
    <BaseDrawer.Portal>
      <BaseDrawer.Backdrop />
      <BaseDrawer.Viewport>
        <BaseDrawer.Popup>
          <BaseDrawer.Content>
            <BaseDrawer.Title>{title}</BaseDrawer.Title>
            {children}
            <BaseDrawer.Close>Close {title}</BaseDrawer.Close>
          </BaseDrawer.Content>
        </BaseDrawer.Popup>
      </BaseDrawer.Viewport>
    </BaseDrawer.Portal>
  );
}

function VaulPlain({ title, children }: ContentProps) {
  return (
    <VaulDrawer.Portal>
      <VaulDrawer.Overlay />
      <VaulDrawer.Content aria-describedby={undefined}>
        <VaulDrawer.Title>{title}</VaulDrawer.Title>
        {children}
        <VaulDrawer.Close>Close {title}</VaulDrawer.Close>
      </VaulDrawer.Content>
    </VaulDrawer.Portal>
  );
}

const radixDialog: Kit = {
  label: "Radix Dialog",
  Root: RadixDialog.Root,
  Trigger: RadixDialog.Trigger,
  kind: "dialog",
  adapter: adapters.radix,
  content: { plain: RadixPlain },
  nested: () => radixDialog,
};
const baseDialog: Kit = {
  label: "Base UI Dialog",
  Root: BaseDialog.Root,
  Trigger: BaseDialog.Trigger,
  kind: "dialog",
  adapter: adapters.baseUi,
  content: { plain: BasePlain },
  nested: () => baseDialog,
};
const kits: Kit[] = [
  radixDialog,
  {
    label: "Radix AlertDialog",
    Root: RadixAlertDialog.Root,
    Trigger: RadixAlertDialog.Trigger,
    kind: "alert-dialog",
    adapter: adapters.radix,
    content: { plain: RadixAlertPlain },
    nested: () => radixDialog,
  },
  baseDialog,
  {
    label: "Base UI AlertDialog",
    Root: BaseAlertDialog.Root,
    Trigger: BaseAlertDialog.Trigger,
    kind: "alert-dialog",
    adapter: adapters.baseUi,
    content: { plain: BaseAlertPlain },
    nested: () => baseDialog,
  },
  {
    label: "Base UI Drawer",
    Root: BaseDrawer.Root,
    Trigger: BaseDrawer.Trigger,
    kind: "drawer",
    adapter: adapters.baseUi,
    content: { plain: BaseDrawerPlain },
    nested: () => baseDialog,
  },
  {
    label: "vaul Drawer",
    Root: VaulDrawer.Root,
    Trigger: VaulDrawer.Trigger,
    kind: "drawer",
    adapter: adapters.vaul,
    content: { plain: VaulPlain },
    nested: () => radixDialog,
  },
];

// --- "before" and "after" ------------------------------------------------------------------

type Integration = "managed() only" | "managed() + <ModalActivity>";

/** What a scenario renders with: the plain primitives, or the adopted ones. */
type Env = {
  Provider: ComponentType<{ children?: ReactNode }>;
  Root: AnyRoot;
  Trigger: Kit["Trigger"];
  Content: ComponentType<ContentProps>;
  NestedRoot: AnyRoot;
  NestedTrigger: Kit["Trigger"];
  NestedContent: ComponentType<ContentProps>;
  /** Props that make a root a managed, named modal "after"; none "before". */
  named: Record<string, string>;
};

function Fragment({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function before(kit: Kit): Env {
  const nested = kit.nested();
  return {
    Provider: Fragment,
    Root: kit.Root,
    Trigger: kit.Trigger,
    Content: kit.content.plain,
    NestedRoot: nested.Root,
    NestedTrigger: nested.Trigger,
    NestedContent: nested.content.plain,
    named: {},
  };
}

function after(kit: Kit, integration: Integration): Env {
  const modals = createManagedModals({ policies });
  const nested = kit.nested();
  const content = (of: Kit): ComponentType<ContentProps> =>
    integration === "managed() + <ModalActivity>" ? withActivity(of.content.plain) : of.content.plain;
  return {
    Provider: modals.ModalProvider,
    Root: modals.managed(kit.Root, { kind: kit.kind, adapter: kit.adapter }),
    Trigger: kit.Trigger,
    Content: content(kit),
    NestedRoot: modals.managed(nested.Root, { kind: nested.kind, adapter: nested.adapter }),
    NestedTrigger: nested.Trigger,
    NestedContent: content(nested),
    named: { name: "billing" },
  };
}

// --- scenarios --------------------------------------------------------------------------------

/** Ways for a scenario's steps to reach into its app. */
type Controls = Record<string, (open: boolean) => void>;

type Scenario = {
  name: string;
  App: (props: { env: Env; log: (entry: string) => void; controls: Controls }) => ReactNode;
  steps: ((controls: Controls) => void)[];
};

/** onOpenChange as the application writes it, logging what it receives. */
function logged(name: string, log: (entry: string) => void, set?: (open: boolean) => void) {
  return (open: boolean, details?: { reason?: string }) => {
    log(`${name}: onOpenChange(${open}${details?.reason ? `, ${details.reason}` : ""})`);
    set?.(open);
  };
}

function click(text: string) {
  fireEvent.click(screen.getByText(text));
}

function escape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
}

function pressOutside() {
  fireEvent.pointerDown(document.body, { pointerType: "mouse" });
  fireEvent.mouseDown(document.body);
  fireEvent.pointerUp(document.body, { pointerType: "mouse" });
  fireEvent.mouseUp(document.body);
  fireEvent.click(document.body);
}

const scenarios: Scenario[] = [
  {
    name: "uncontrolled, opened from its trigger, typed into, closed with Escape and with Close",
    App: ({ env, log }) => (
      <env.Provider>
        <env.Root onOpenChange={logged("A", log)}>
          <env.Trigger>Open A</env.Trigger>
          <env.Content title="A">
            <input aria-label="A field" />
          </env.Content>
        </env.Root>
      </env.Provider>
    ),
    steps: [
      () => click("Open A"),
      () => fireEvent.change(screen.getByLabelText("A field"), { target: { value: "typed" } }),
      () => escape(),
      () => click("Open A"),
      () => click("Close A"),
    ],
  },
  {
    name: "controlled, opened from outside, closed by a press outside and by Close",
    App: ({ env, log, controls }) => {
      const [open, setOpen] = useState(false);
      controls.b = setOpen;
      return (
        <env.Provider>
          <button onClick={() => setOpen(true)}>Show B</button>
          <env.Root open={open} onOpenChange={logged("B", log, setOpen)}>
            <env.Content title="B" />
          </env.Root>
        </env.Provider>
      );
    },
    steps: [() => click("Show B"), () => pressOutside(), () => click("Show B"), () => click("Close B")],
  },
  {
    name: "open from the start (defaultOpen)",
    App: ({ env, log }) => (
      <env.Provider>
        <env.Root defaultOpen onOpenChange={logged("C", log)}>
          <env.Content title="C" />
        </env.Root>
      </env.Provider>
    ),
    steps: [() => click("Close C")],
  },
  {
    name: "two independent dialogs open at once, and a nested one: they stack, nothing waits",
    App: ({ env, log, controls }) => {
      const [open, setOpen] = useState(false);
      controls.e = setOpen;
      return (
        <env.Provider>
          <env.Root onOpenChange={logged("D", log)}>
            <env.Trigger>Open D</env.Trigger>
            <env.Content title="D">
              <env.NestedRoot onOpenChange={logged("D nested", log)}>
                <env.NestedTrigger>Open nested</env.NestedTrigger>
                <env.NestedContent title="Nested" />
              </env.NestedRoot>
            </env.Content>
          </env.Root>
          <env.Root open={open} onOpenChange={logged("E", log, setOpen)}>
            <env.Content title="E" />
          </env.Root>
        </env.Provider>
      );
    },
    steps: [
      () => click("Open D"),
      () => click("Open nested"),
      (controls) => controls.e?.(true),
      () => escape(),
      () => escape(),
      () => escape(),
    ],
  },
  {
    name: "a named modal beside unnamed ones (partial adoption): the unnamed ones do not change",
    App: ({ env, log, controls }) => {
      const [billing, setBilling] = useState(false);
      controls.billing = setBilling;
      return (
        <env.Provider>
          <env.Root onOpenChange={logged("F", log)}>
            <env.Trigger>Open F</env.Trigger>
            <env.Content title="F" />
          </env.Root>
          <env.Root {...env.named} open={billing} onOpenChange={logged("billing", log, setBilling)}>
            <env.Content title="Billing" />
          </env.Root>
        </env.Provider>
      );
    },
    steps: [() => click("Open F"), (controls) => controls.billing?.(true), () => escape(), () => escape()],
  },
];

// --- runner -----------------------------------------------------------------------------------

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

/** The DOM, focus and log after a step, with generated ids numbered by first appearance. */
function snapshot(log: string[]): string {
  const ids = new Map<string, string>();
  const html = document.body.innerHTML.replace(/_r_[0-9a-z]+_/g, (id) => {
    if (!ids.has(id)) ids.set(id, `id${ids.size}`);
    return ids.get(id)!;
  });
  const active = document.activeElement;
  const focus =
    !active || active === document.body
      ? "body"
      : `${active.tagName} "${(active.getAttribute("aria-label") ?? active.textContent ?? "").slice(0, 40)}"`;
  return JSON.stringify({ focus, log: [...log], html }, null, 1);
}

async function run(scenario: Scenario, env: Env): Promise<string[]> {
  const log: string[] = [];
  const controls: Controls = {};
  const warn = vi.spyOn(console, "warn");
  const error = vi.spyOn(console, "error");
  const snapshots: string[] = [];
  try {
    render(<scenario.App env={env} log={(entry) => log.push(entry)} controls={controls} />);
    await settle();
    snapshots.push(snapshot(log));
    for (const step of scenario.steps) {
      await act(async () => step(controls));
      await settle();
      snapshots.push(snapshot(log));
    }
    snapshots.push(`console.warn: ${JSON.stringify(warn.mock.calls)}\nconsole.error: ${JSON.stringify(error.mock.calls.map(String))}`);
  } finally {
    warn.mockRestore();
    error.mockRestore();
    cleanup();
  }
  return snapshots;
}

const integrations: Integration[] = ["managed() only", "managed() + <ModalActivity>"];

describe.each(kits)("$label", (kit) => {
  describe.each(integrations)("%s, no names", (integration) => {
    test.each(scenarios)("$name", async (scenario) => {
      const expected = await run(scenario, before(kit));
      const actual = await run(scenario, after(kit, integration));
      expect(actual).toEqual(expected);
    });
  });
});

describe("the check itself", () => {
  test("it sees the difference once modals are named: named modals are scheduled", async () => {
    const scenario = scenarios.find((candidate) => candidate.name.startsWith("two independent"))!;
    const namedEverywhere: Env = {
      ...after(radixDialog, "managed() only"),
    };
    const NamedRoot = namedEverywhere.Root;
    namedEverywhere.Root = (props: object) => <NamedRoot name="billing" {...props} />;

    const expected = await run(scenario, before(radixDialog));
    const actual = await run(scenario, namedEverywhere);
    expect(actual).not.toEqual(expected);
  });
});
