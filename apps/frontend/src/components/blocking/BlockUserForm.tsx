import { useEffect, useRef, useState } from "preact/hooks";
import type { BlockListApi } from "../../api/client.js";
import type {
  BlockedUser,
  ReverseDirection,
  ReverseRequest,
  ReverseWindow,
  Transaction,
} from "../../api/types.js";
import { formatTransactionCount } from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";
import { ActionStatus } from "../shared/ActionStatus.jsx";
import { Button } from "../shared/Button.jsx";
import { Checkbox } from "../shared/Checkbox.jsx";
import { Field } from "../shared/Field.jsx";
import { RadioGroup } from "../shared/RadioGroup.jsx";
import { ReversalReview } from "./ReversalReview.jsx";
import { DIRECTION_OPTIONS, WINDOW_OPTIONS } from "./reversalOptions.js";
import "./BlockUserForm.scss";
import "../layout/Panel.scss";

const INLINE_FIELDS = ["userId", "reason", "direction"];

interface BlockUserFormProps {
  blockList: BlockListApi;
  scope: string;
  onBlocked: (blocked: BlockedUser) => void;
  onCancel: () => void;
}

export function BlockUserForm({
  blockList,
  scope,
  onBlocked,
  onCancel,
}: BlockUserFormProps) {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [period, setPeriod] = useState<ReverseWindow>("24h");
  const [direction, setDirection] = useState<ReverseDirection>();
  const [preview, setPreview] = useState<Transaction[] | null>(null);
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const pending = action.state.status === "pending";
  const ownerBlock = blockList.level === "currency";

  useEffect(() => {
    if (action.state.status !== "failed") return;

    const field = action.state.error.field;
    if (field !== undefined && INLINE_FIELDS.includes(field)) setPreview(null);
  }, [action.state]);

  useEffect(() => {
    const form = formRef.current;
    if (form === null) throw new Error("The block form didn't render");

    const target = form.querySelector<HTMLElement>(
      preview === null ? "[aria-invalid='true']" : ".reversal-review__title",
    );
    target?.focus();
  }, [preview, action.state]);

  function reverseRequest(): ReverseRequest {
    return ownerBlock ? { window: period, direction } : { window: period };
  }

  function blockedMessage(blocked: BlockedUser, reversedCount: number) {
    const blockedText = `Blocked ${blocked.userId} ${scope}`;
    if (reversedCount === 0) return `${blockedText}.`;

    return `${blockedText} and reversed ${formatTransactionCount(reversedCount)}.`;
  }

  function blockOnly() {
    void action.run(async () => {
      const { blocked, reversed } = await blockList.block(userId, reason);
      onBlocked(blocked);

      return blockedMessage(blocked, reversed.length);
    });
  }

  function review() {
    void action.attempt(async () => {
      setPreview(
        await blockList.previewBlock(userId, reason, reverseRequest()),
      );
    });
  }

  function blockAndReverse() {
    void action.run(async () => {
      const { blocked, reversed } = await blockList.block(
        userId,
        reason,
        reverseRequest(),
      );
      onBlocked(blocked);

      return blockedMessage(blocked, reversed.length);
    });
  }

  function submit(event: Event) {
    event.preventDefault();
    if (reversing) review();
    else blockOnly();
  }

  return (
    <form ref={formRef} class="form-stack" onSubmit={submit}>
      {preview === null ? (
        <>
          <Field
            label="Discord user ID"
            inputMode="numeric"
            autoComplete="off"
            value={userId}
            disabled={pending}
            error={action.fieldError("userId")}
            onInput={(event) => setUserId(event.currentTarget.value)}
          />
          <Field
            label="Reason"
            autoComplete="off"
            value={reason}
            disabled={pending}
            error={action.fieldError("reason")}
            onInput={(event) => setReason(event.currentTarget.value)}
          />
          <Checkbox
            label="Also reverse their completed transactions"
            checked={reversing}
            disabled={pending}
            onChange={setReversing}
          />
          {reversing && (
            <div class="block-form__reversal">
              <RadioGroup<ReverseWindow>
                legend="Reverse transactions from"
                options={WINDOW_OPTIONS}
                value={period}
                disabled={pending}
                onChange={setPeriod}
              />
              {ownerBlock && (
                <RadioGroup<ReverseDirection>
                  legend="Direction"
                  options={DIRECTION_OPTIONS}
                  value={direction}
                  error={action.fieldError("direction")}
                  disabled={pending}
                  onChange={setDirection}
                />
              )}
            </div>
          )}
          <div class="form-actions">
            <Button type="submit" variant="danger" disabled={pending}>
              {reversing ? "Review reversal" : "Block user"}
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <ReversalReview
          transactions={preview}
          pending={pending}
          onConfirm={blockAndReverse}
          onBack={() => setPreview(null)}
        />
      )}
      <ActionStatus state={action.state} inlineFields={INLINE_FIELDS} />
    </form>
  );
}
