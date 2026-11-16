import type { RemovalPreview } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Dialog } from "../../components/shared/Dialog.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { Notice } from "../../components/shared/Notice.jsx";
import { formatBlockCount, formatTransactionCount } from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";
import { useRequest } from "../../lib/useRequest.js";

export type RemovalKind = "bot" | "currency";

export interface RemovalSubject {
  kind: RemovalKind;
  name: string;
  preview: () => Promise<RemovalPreview>;
  remove: () => Promise<void>;
}

interface RemovalDialogProps {
  subject: RemovalSubject;
  onRemoved: () => Promise<void>;
  onClose: () => void;
}

const CONFIRM_LABELS: Record<RemovalKind, string> = {
  bot: "Remove bot",
  currency: "Remove currency",
};

export function RemovalDialog({
  subject,
  onRemoved,
  onClose,
}: RemovalDialogProps) {
  const request = useRequest(() => subject.preview(), []);
  const action = useAction();

  function remove() {
    void action.run(async () => {
      await subject.remove();
      await onRemoved();

      return `Removed ${subject.name}.`;
    });
  }

  return (
    <Dialog title={`Remove ${subject.name}?`} onClose={onClose}>
      <div class="form-stack">
        <Loadable
          state={request.state}
          label="what this removes"
          onRetry={request.reload}
        >
          {(preview) => (
            <RemovalSummary kind={subject.kind} preview={preview} />
          )}
        </Loadable>
        <div class="form-actions">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={
              request.state.status !== "ready" ||
              action.state.status === "pending"
            }
            onClick={remove}
          >
            {CONFIRM_LABELS[subject.kind]}
          </Button>
        </div>
        <ActionStatus state={action.state} inlineFields={[]} />
      </div>
    </Dialog>
  );
}

interface RemovalSummaryProps {
  kind: RemovalKind;
  preview: RemovalPreview;
}

function RemovalSummary({ kind, preview }: RemovalSummaryProps) {
  const { currencies, pendingTransactions, enforcedBlocks } = preview;

  return (
    <>
      {currencies.length === 0 ? (
        <p>This bot runs no currencies, so no currency is removed.</p>
      ) : (
        <>
          <p>These currencies are removed:</p>
          <ul class="removal__list">
            {currencies.map(({ id, abbreviation, name }) => (
              <li key={id}>
                {abbreviation} ({name})
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        {formatTransactionCount(pendingTransactions)} still Pending will be
        cancelled and refunded.
      </p>
      {(kind === "bot" || enforcedBlocks > 0) && (
        <p>{formatBlockCount(enforcedBlocks)} will stop being enforced.</p>
      )}
      {kind === "bot" && (
        <p>The bot's API token and webhook stop working at once.</p>
      )}
      <p>
        Past transactions stay in the history, where the currency shows as
        removed.
      </p>
      <Notice tone="warning" title="This can't be undone">
        <p>There is no way to bring back a removed bot or currency.</p>
      </Notice>
    </>
  );
}
