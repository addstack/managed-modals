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
  createManagedRoot,
  type ManagedOptions,
  type ManagedRootOwnProps,
  type ManagedRootProps,
} from "./managed.js";
export { ModalActivity } from "./modal-activity.js";
export { useFocusOnResume } from "./use-focus-on-resume.js";
export {
  useManagedModal,
  type UseManagedModalOptions,
  type UseManagedModalResult,
} from "./use-managed-modal.js";
export { usePauseWhileSuspended } from "./use-pause-while-suspended.js";
