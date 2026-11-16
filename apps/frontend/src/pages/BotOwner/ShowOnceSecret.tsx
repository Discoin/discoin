import { useEffect, useRef, useState } from "preact/hooks";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { ConfirmButton } from "../../components/shared/ConfirmButton.jsx";
import { SecretField } from "../../components/shared/SecretField.jsx";
import { useAction } from "../../lib/useAction.js";
import { useUnsavedChanges } from "./unsavedChanges.js";

export interface ShowOnceCopy {
  label: string;
  missing: string;
  kept: string;
  createLabel: string;
  created: string;
  regenerated: string;
  warning: string;
  confirmLabel: string;
  cancelLabel: string;
  dismissLabel: string;
}

interface ShowOnceSecretProps {
  exists: boolean;
  issue: () => Promise<string>;
  copy: ShowOnceCopy;
}

export function ShowOnceSecret({ exists, issue, copy }: ShowOnceSecretProps) {
  const [issued, setIssued] = useState<string | null>(null);
  const [hasSecret, setHasSecret] = useState(exists);
  const shownRef = useRef<HTMLDivElement>(null);
  const keptRef = useRef<HTMLParagraphElement>(null);
  const dismissed = useRef(false);
  const action = useAction();
  const pending = action.state.status === "pending";
  useUnsavedChanges(copy.label, {
    hasChanges: issued !== null,
    isSaving: pending,
  });

  useEffect(() => {
    if (issued !== null) shownRef.current?.focus();
    else if (dismissed.current) keptRef.current?.focus();
  }, [issued]);

  function dismiss() {
    dismissed.current = true;
    setIssued(null);
  }

  function issueSecret() {
    const isFirst = !hasSecret;
    void action.run(async () => {
      setIssued(await issue());
      setHasSecret(true);

      return isFirst ? copy.created : copy.regenerated;
    });
  }

  if (!hasSecret) {
    return (
      <div class="form-stack">
        <div class="form-actions">
          <p>{copy.missing}</p>
          <Button variant="primary" disabled={pending} onClick={issueSecret}>
            {copy.createLabel}
          </Button>
        </div>
        <ActionStatus state={action.state} inlineFields={[]} />
      </div>
    );
  }

  const regenerate = (
    <ConfirmButton
      label={
        <>
          Regenerate<span class="visually-hidden"> {copy.label}</span>
        </>
      }
      variant="danger"
      warning={copy.warning}
      confirmLabel={copy.confirmLabel}
      cancelLabel={copy.cancelLabel}
      disabled={pending}
      onConfirm={issueSecret}
    />
  );

  return (
    <div class="form-stack">
      {issued === null ? (
        <div class="form-actions">
          <p ref={keptRef} tabIndex={-1}>
            {copy.kept}
          </p>
          {regenerate}
        </div>
      ) : (
        <div ref={shownRef} tabIndex={-1} class="form-stack">
          <p>Copy it now. Discoin only shows it once.</p>
          <SecretField label={copy.label} secret={issued}>
            {regenerate}
          </SecretField>
          <div class="form-actions">
            <Button variant="outline" disabled={pending} onClick={dismiss}>
              {copy.dismissLabel}
            </Button>
          </div>
        </div>
      )}
      <ActionStatus state={action.state} inlineFields={[]} />
    </div>
  );
}
