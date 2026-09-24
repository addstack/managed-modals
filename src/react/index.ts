"use client";

export { adapters, type ModalAdapter } from "./adapters.js";
export {
  ManagedModalContext,
  useManagedModalContext,
  useModalPresentation,
  type ManagedModalContextValue,
} from "./context.js";
export {
  createManagedModals,
  type ManagedModals,
  type ModalProviderProps,
} from "./create-managed-modals.js";
export {
  createManagedPrimitive,
  createManagedRoot,
  type ManagedOptions,
  type ManagedPrimitive,
  type ManagedRootOwnProps,
  type ManagedRootProps,
  type PrimitiveParts,
} from "./managed.js";
export { ModalActivity } from "./modal-activity.js";
export {
  useManagedModal,
  type UseManagedModalOptions,
  type UseManagedModalResult,
} from "./use-managed-modal.js";
export { usePauseWhileSuspended } from "./use-pause-while-suspended.js";
