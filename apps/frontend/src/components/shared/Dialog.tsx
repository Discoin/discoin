import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import "./Dialog.scss";

const FIRST_FIELD = "input, select, textarea, button:not(.dialog__close)";

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}

function focusFirstField(dialog: HTMLDialogElement): void {
  const field = dialog.querySelector<HTMLElement>(FIRST_FIELD);
  if (field === null) throw new Error("A dialog needs something to focus");

  field.focus();
}

export function Dialog({ title, onClose, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) throw new Error("The dialog didn't render");

    const opener = document.activeElement;
    dialog.showModal();
    focusFirstField(dialog);

    return () => {
      dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      class="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div class="dialog__head">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          class="dialog__close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {children}
    </dialog>
  );
}
