import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

export function useModal(
  dialogRef: RefObject<HTMLDialogElement>,
  focusOnOpen: (dialog: HTMLDialogElement) => void,
): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) throw new Error("The dialog didn't render");

    const opener = document.activeElement;
    dialog.showModal();
    focusOnOpen(dialog);

    return () => {
      dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
}
