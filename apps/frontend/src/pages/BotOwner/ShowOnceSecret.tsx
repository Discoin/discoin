import { useEffect, useRef, useState } from "preact/hooks";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { ConfirmButton } from "../../components/shared/ConfirmButton.jsx";
import { SecretField } from "../../components/shared/SecretField.jsx";
import { useAction } from "../../lib/useAction.js";

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
  const action = useAction();

  useEffect(() => {
    if (issued !== null) shownRef.current?.focus();
  }, [issued]);

  function issueSecret() {
    const isFirst = !hasSecret;
    void action.run(async () => {
      setIssued(await issue());
      setHasSecret(true);

      return isFirst ? copy.created : copy.regenerated;
    });
  }

  const pending = action.state.status === "pending";

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
          <p>{copy.kept}</p>
          {regenerate}
        </div>
      ) : (
        <div ref={shownRef} tabIndex={-1} class="form-stack">
          <p>Copy it now. Discoin only shows it once.</p>
          <SecretField label={copy.label} secret={issued}>
            {regenerate}
          </SecretField>
        </div>
      )}
      <ActionStatus state={action.state} inlineFields={[]} />
    </div>
  );
}
