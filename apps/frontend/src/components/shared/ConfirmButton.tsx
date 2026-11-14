import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, type ButtonVariant } from "./Button.jsx";
import "./ConfirmButton.scss";

interface ConfirmButtonProps {
  label: ComponentChildren;
  variant: ButtonVariant;
  warning: ComponentChildren;
  confirmLabel: string;
  cancelLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}

export function ConfirmButton({
  label,
  variant,
  warning,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const hasToggled = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hasToggled.current) return;

    const target = confirming ? cancelRef.current : triggerRef.current;
    target?.focus();
  }, [confirming]);

  function toggle(next: boolean) {
    hasToggled.current = true;
    setConfirming(next);
  }

  function confirm() {
    toggle(false);
    onConfirm();
  }

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        variant={variant}
        disabled={disabled}
        onClick={() => toggle(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div class="confirm-button" role="alert">
      <p>{warning}</p>
      <Button variant="danger" onClick={confirm}>
        {confirmLabel}
      </Button>
      <Button ref={cancelRef} variant="outline" onClick={() => toggle(false)}>
        {cancelLabel}
      </Button>
    </div>
  );
}
