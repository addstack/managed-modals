import { Dialog as BaseDialogPrimitive } from "@base-ui/react/dialog";
import { Drawer as BaseDrawerPrimitive } from "@base-ui/react/drawer";
import * as RadixDialogPrimitive from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
import { Drawer as VaulDrawerPrimitive } from "vaul";

import type { ModalDismissReason, ModalName as PolicyName } from "../../src/core/index.js";
import { adapters, createManagedModals, usePauseWhileSuspended } from "../../src/react/index.js";
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
  "intro-video": { priority: 40 },
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
  /** Base UI only: associates detached `Dialog.Trigger`s rendered elsewhere. */
  handle?: BaseDialogPrimitive.Handle<unknown>;
  children?: ReactNode;
};

type ContentProps = { title: string; children?: ReactNode };

// Every primitive is integrated as the README shows it for the shadcn/ui files:
// its parts are wrapped with managed(), and the components built on them are unchanged.

// --- Radix Dialog -----------------------------------------------------------

const RadixDialog = modals.managed(RadixDialogPrimitive, { kind: "dialog", adapter: adapters.radix });

export function RadixModal({ title, trigger, children, handle: _handle, ...root }: ModalProps) {
  return (
    <RadixDialog.Root {...root}>
      {trigger !== undefined && <RadixDialog.Trigger>{trigger}</RadixDialog.Trigger>}
      <RadixContent title={title}>{children}</RadixContent>
    </RadixDialog.Root>
  );
}

/** shadcn/ui `DialogContent` on Radix. */
function RadixContent({ title, children }: ContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="overlay" />
      <RadixDialog.Content className="popup" aria-describedby={undefined}>
        <RadixDialog.Title>{title}</RadixDialog.Title>
        {children}
        <RadixDialog.Close>Close</RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

// --- Base UI Dialog ---------------------------------------------------------

const BaseDialog = modals.managed(BaseDialogPrimitive, { kind: "dialog", adapter: adapters.baseUi });

export function BaseModal({ title, trigger, children, ...root }: ModalProps) {
  return (
    <BaseDialog.Root {...root}>
      {trigger !== undefined && <BaseDialog.Trigger>{trigger}</BaseDialog.Trigger>}
      <BaseContent title={title}>{children}</BaseContent>
    </BaseDialog.Root>
  );
}

/** shadcn/ui `DialogContent` on Base UI. */
function BaseContent({ title, children }: ContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="overlay" />
      <BaseDialog.Popup className="popup">
        <BaseDialog.Title>{title}</BaseDialog.Title>
        {children}
        <BaseDialog.Close>Close</BaseDialog.Close>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

// --- vaul Drawer ------------------------------------------------------------

const VaulDrawer = modals.managed(VaulDrawerPrimitive, { kind: "drawer", adapter: adapters.vaul });

/** shadcn/ui `Drawer` (vaul). */
export function VaulModal({ title, trigger, children, handle: _handle, ...root }: ModalProps) {
  return (
    <VaulDrawer.Root {...root}>
      {trigger !== undefined && <VaulDrawer.Trigger>{trigger}</VaulDrawer.Trigger>}
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className="drawer-overlay" />
        <VaulDrawer.Content className="drawer" aria-describedby={undefined}>
          <VaulDrawer.Title>{title}</VaulDrawer.Title>
          {children}
          <VaulDrawer.Close>Close</VaulDrawer.Close>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  );
}

// --- Base UI Drawer ---------------------------------------------------------

const BaseDrawer = modals.managed(BaseDrawerPrimitive, { kind: "drawer", adapter: adapters.baseUi });

export function BaseDrawerModal({ title, trigger, children, handle: _handle, ...root }: ModalProps) {
  return (
    <BaseDrawer.Root {...root}>
      {trigger !== undefined && <BaseDrawer.Trigger>{trigger}</BaseDrawer.Trigger>}
      <BaseDrawerContent title={title}>{children}</BaseDrawerContent>
    </BaseDrawer.Root>
  );
}

function BaseDrawerContent({ title, children }: ContentProps) {
  return (
    <BaseDrawer.Portal>
      <BaseDrawer.Backdrop className="drawer-overlay" />
      <BaseDrawer.Viewport>
        <BaseDrawer.Popup className="drawer">
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

// --- media ------------------------------------------------------------------

/** A video that pauses while its modal is suspended and plays on from the same point afterwards. */
export function Video() {
  const ref = useRef<HTMLVideoElement>(null);
  usePauseWhileSuspended(ref);
  return (
    <>
      <video ref={ref} aria-label="Intro video" muted playsInline loop width={160} height={90}>
        <source src="./clip.webm" type="video/webm" />
        <source src="./clip.mp4" type="video/mp4" />
      </video>
      <button type="button" onClick={() => void ref.current?.play()}>
        Play video
      </button>
    </>
  );
}
