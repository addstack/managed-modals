import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import * as RadixDialog from "@radix-ui/react-dialog";
import { useRef, type ComponentProps, type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";

import type { ModalDismissReason, ModalName as PolicyName } from "../../src/core/index.js";
import { adapters, createManagedModals, useFocusOnResume, useModalPresentation } from "../../src/react/index.js";
import { fromSearch } from "./options.js";

export const options = fromSearch(window.location.search);

const policies = {
  "session-expired": { priority: 100 },
  billing: { priority: 80 },
  "edit-user": { priority: 40 },
  // Nested in "Edit user": opens on top of it whatever its own priority.
  "delete-confirm": { priority: 10 },
  filters: { priority: 30 },
  onboarding: { priority: 10, onPreempt: "dismiss" },
} as const;

export type ModalName = PolicyName<typeof policies>;

export const modals = createManagedModals({
  policies,
  awaitExit: options.awaitExit,
  exitTimeoutMs: options.exitTimeoutMs,
});

/** One modal of the fixture, whatever primitive renders it. */
export type ModalProps = {
  /** Without a name the modal is not scheduled, unless it is nested in a managed one. */
  name?: ModalName;
  title: string;
  /** Label of a trigger button, rendered where the modal is. */
  trigger?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: (reason: ModalDismissReason) => void;
  children?: ReactNode;
};

type ContentProps = { title: string; children?: ReactNode };

// --- Radix Dialog -----------------------------------------------------------

const RadixRoot = modals.managed(RadixDialog.Root, { kind: "dialog", adapter: adapters.radix });

export function RadixModal({ title, trigger, children, ...root }: ModalProps) {
  return (
    <RadixRoot {...root}>
      {trigger !== undefined && <RadixDialog.Trigger>{trigger}</RadixDialog.Trigger>}
      <RadixContent title={title}>{children}</RadixContent>
    </RadixRoot>
  );
}

/** shadcn/ui `DialogContent` on Radix, with the changes from the README. */
function RadixContent({ title, children }: ContentProps) {
  const managed = useModalPresentation();
  const suspended = managed?.status === "suspended";
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusOnResume(contentRef);
  return (
    <RadixDialog.Portal {...(managed?.keepMounted ? { forceMount: true } : {})}>
      {!suspended && <RadixDialog.Overlay className="overlay" />}
      <RadixDialog.Content
        ref={contentRef}
        className="popup"
        aria-describedby={undefined}
        hidden={suspended || undefined}
        onCloseAutoFocus={(event) => {
          if (managed?.suppressFinalFocus) event.preventDefault();
        }}
      >
        <RadixDialog.Title>{title}</RadixDialog.Title>
        {children}
        <RadixDialog.Close>Close</RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

// --- Base UI Dialog ---------------------------------------------------------

const BaseRoot = modals.managed(
  (props: ComponentProps<typeof BaseDialog.Root>) => <BaseDialog.Root {...props} />,
  { kind: "dialog", adapter: adapters.baseUi },
);

export function BaseModal({ title, trigger, children, ...root }: ModalProps) {
  return (
    <BaseRoot {...root}>
      {trigger !== undefined && <BaseDialog.Trigger>{trigger}</BaseDialog.Trigger>}
      <BaseContent title={title}>{children}</BaseContent>
    </BaseRoot>
  );
}

/** shadcn/ui `DialogContent` on Base UI, with the changes from the README. */
function BaseContent({ title, children }: ContentProps) {
  const managed = useModalPresentation();
  return (
    <BaseDialog.Portal keepMounted={managed?.keepMounted}>
      <BaseDialog.Backdrop className="overlay" />
      <BaseDialog.Popup className="popup" finalFocus={managed?.suppressFinalFocus ? false : undefined}>
        <BaseDialog.Title>{title}</BaseDialog.Title>
        {children}
        <BaseDialog.Close>Close</BaseDialog.Close>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

// --- vaul Drawer ------------------------------------------------------------

const VaulRoot = modals.managed(VaulDrawer.Root, { kind: "drawer", adapter: adapters.vaul });

/** shadcn/ui `Drawer` (vaul), unchanged: keeping a suspended vaul drawer mounted is not supported yet. */
export function VaulModal({ title, trigger, children, ...root }: ModalProps) {
  return (
    <VaulRoot {...root}>
      {trigger !== undefined && <VaulDrawer.Trigger>{trigger}</VaulDrawer.Trigger>}
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className="drawer-overlay" />
        <VaulDrawer.Content className="drawer" aria-describedby={undefined}>
          <VaulDrawer.Title>{title}</VaulDrawer.Title>
          {children}
          <VaulDrawer.Close>Close</VaulDrawer.Close>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulRoot>
  );
}

// --- Base UI Drawer ---------------------------------------------------------

const BaseDrawerRoot = modals.managed(
  (props: ComponentProps<typeof BaseDrawer.Root>) => <BaseDrawer.Root {...props} />,
  { kind: "drawer", adapter: adapters.baseUi },
);

export function BaseDrawerModal({ title, trigger, children, ...root }: ModalProps) {
  return (
    <BaseDrawerRoot {...root}>
      {trigger !== undefined && <BaseDrawer.Trigger>{trigger}</BaseDrawer.Trigger>}
      <BaseDrawerContent title={title}>{children}</BaseDrawerContent>
    </BaseDrawerRoot>
  );
}

function BaseDrawerContent({ title, children }: ContentProps) {
  const managed = useModalPresentation();
  return (
    <BaseDrawer.Portal keepMounted={managed?.keepMounted}>
      <BaseDrawer.Backdrop className="drawer-overlay" />
      <BaseDrawer.Viewport>
        <BaseDrawer.Popup className="drawer" finalFocus={managed?.suppressFinalFocus ? false : undefined}>
          <BaseDrawer.Content>
            <BaseDrawer.Title>{title}</BaseDrawer.Title>
            {children}
            <BaseDrawer.Close>Close</BaseDrawer.Close>
          </BaseDrawer.Content>
        </BaseDrawer.Popup>
      </BaseDrawer.Viewport>
    </BaseDrawer.Portal>
  );
}
