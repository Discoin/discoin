import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

const POPUP_OPENED = "disclosure-popup-opened";

export interface Disclosure<Trigger extends HTMLElement = HTMLButtonElement> {
  isOpen: boolean;
  panelId: string;
  triggerRef: RefObject<Trigger>;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

export function useDisclosure<
  Trigger extends HTMLElement = HTMLButtonElement,
>(): Disclosure<Trigger> {
  const [isOpen, setOpen] = useState(false);
  const triggerRef = useRef<Trigger>(null);
  const panelId = useId();

  return {
    isOpen,
    panelId,
    triggerRef,
    toggle: () => setOpen(!isOpen),
    open: () => setOpen(true),
    close: () => setOpen(false),
  };
}

interface DisclosureTriggerProps {
  disclosure: Disclosure;
  class: string;
  children: ComponentChildren;
}

export function DisclosureTrigger({
  disclosure,
  class: className,
  children,
}: DisclosureTriggerProps) {
  return (
    <button
      ref={disclosure.triggerRef}
      type="button"
      class={className}
      aria-expanded={disclosure.isOpen}
      aria-controls={disclosure.panelId}
      onClick={disclosure.toggle}
    >
      {children}
    </button>
  );
}

export interface PopupDismissal {
  rootRef: RefObject<HTMLDivElement>;
  closeOnEscape: (event: KeyboardEvent) => void;
}

type AnyDisclosure = Disclosure<HTMLElement>;

function useCloseOnOutsidePointer(
  disclosure: AnyDisclosure,
  rootRef: RefObject<HTMLDivElement>,
): void {
  const { isOpen, close } = disclosure;

  useEffect(() => {
    if (!isOpen) return;

    function closeIfOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }

    document.addEventListener("pointerdown", closeIfOutside);

    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, [isOpen]);
}

function useCloseWhenAnotherPopupOpens(disclosure: AnyDisclosure): void {
  const { isOpen, panelId, close } = disclosure;

  useEffect(() => {
    if (!isOpen) return;

    document.dispatchEvent(new CustomEvent(POPUP_OPENED, { detail: panelId }));

    function closeIfAnother(event: Event) {
      if ((event as CustomEvent<string>).detail !== panelId) close();
    }

    document.addEventListener(POPUP_OPENED, closeIfAnother);

    return () => document.removeEventListener(POPUP_OPENED, closeIfAnother);
  }, [isOpen]);
}

export function usePopupDismissal(disclosure: AnyDisclosure): PopupDismissal {
  const rootRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsidePointer(disclosure, rootRef);
  useCloseWhenAnotherPopupOpens(disclosure);

  function closeOnEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || !disclosure.isOpen) return;

    disclosure.close();
    disclosure.triggerRef.current?.focus();
  }

  return { rootRef, closeOnEscape };
}
