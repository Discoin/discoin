import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { AdminCurrency, CurrencyChanges } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { Notice } from "../../components/shared/Notice.jsx";
import { Switch } from "../../components/shared/Switch.jsx";
import { parseAmount } from "../../lib/converter.js";
import { startingReserve } from "../../lib/exchange.js";
import { formatAmount } from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";

type Step = "edit" | "review";

interface EditCurrencyFormProps {
  entry: AdminCurrency;
  onSaved: (updated: AdminCurrency) => void;
  onCancel: () => void;
}

interface FormValues {
  ownerText: string;
  medianText: string;
  active: boolean;
}

function changesOf(entry: AdminCurrency, values: FormValues): CurrencyChanges {
  const changes: CurrencyChanges = {};
  if (values.ownerText.trim() !== entry.ownerId) {
    changes.ownerId = values.ownerText;
  }

  const median = parseAmount(values.medianText);
  if (median !== entry.weeklyMedian) changes.weeklyMedian = median;
  if (values.active !== entry.currency.active) changes.active = values.active;

  return changes;
}

function hasChanges(changes: CurrencyChanges): boolean {
  return Object.keys(changes).length > 0;
}

function saveLabel(resetsReserve: boolean, deactivates: boolean): string {
  if (resetsReserve && deactivates) return "Reset reserve, deactivate and save";
  if (resetsReserve) return "Reset reserve and save";
  if (deactivates) return "Deactivate and save";

  return "Save changes";
}

export function EditCurrencyForm({
  entry,
  onSaved,
  onCancel,
}: EditCurrencyFormProps) {
  const [ownerText, setOwnerText] = useState(entry.ownerId);
  const [medianText, setMedianText] = useState(String(entry.weeklyMedian));
  const [active, setActive] = useState(entry.currency.active);
  const [step, setStep] = useState<Step>("edit");
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const changes = changesOf(entry, { ownerText, medianText, active });
  const { abbreviation } = entry.currency;

  useEffect(() => {
    if (action.state.status === "failed" && action.state.error.field) {
      setStep("edit");
    }
  }, [action.state]);

  useEffect(() => {
    const form = formRef.current;
    if (form === null) throw new Error("The edit form didn't render");

    const target = form.querySelector<HTMLElement>(
      step === "review" ? ".edit-review__title" : "[aria-invalid='true']",
    );
    target?.focus();
  }, [step, action.state]);

  function save() {
    void action.run(async () => {
      const updated = await api.updateCurrency(entry.currency.id, changes);
      onSaved(updated);

      return `Saved ${abbreviation}.`;
    });
  }

  return (
    <form
      ref={formRef}
      class="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        setStep("review");
      }}
    >
      {step === "edit" ? (
        <>
          <Field
            label="Owner ID"
            inputMode="numeric"
            autoComplete="off"
            value={ownerText}
            error={action.fieldError("ownerId")}
            onInput={(event) => setOwnerText(event.currentTarget.value)}
          />
          <Field
            label="Weekly income median"
            inputMode="decimal"
            autoComplete="off"
            value={medianText}
            suffix={abbreviation}
            hint="Changing it resets the reserve."
            error={action.fieldError("weeklyMedian")}
            onInput={(event) => setMedianText(event.currentTarget.value)}
          />
          <div class="edit-form__status">
            <Switch label="Active" checked={active} onChange={setActive} />
            <p class="edit-form__hint">
              {active
                ? `${abbreviation} shows in the table and ticker and can be traded.`
                : `${abbreviation} is hidden and can't be traded. Its page stays up.`}
            </p>
          </div>
          <div class="form-actions">
            <Button
              type="submit"
              variant="primary"
              disabled={!hasChanges(changes)}
            >
              Review changes
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Review
          entry={entry}
          changes={changes}
          medianText={medianText}
          pending={action.state.status === "pending"}
          onBack={() => setStep("edit")}
          onSave={save}
        />
      )}
      <ActionStatus
        state={action.state}
        inlineFields={["ownerId", "weeklyMedian"]}
      />
    </form>
  );
}

interface ReviewProps {
  entry: AdminCurrency;
  changes: CurrencyChanges;
  medianText: string;
  pending: boolean;
  onBack: () => void;
  onSave: () => void;
}

function Review({
  entry,
  changes,
  medianText,
  pending,
  onBack,
  onSave,
}: ReviewProps) {
  const { abbreviation } = entry.currency;
  const resetsReserve = changes.weeklyMedian !== undefined;
  const deactivates = changes.active === false;

  return (
    <div class="edit-review">
      <h3 class="edit-review__title" tabIndex={-1}>
        Review {abbreviation} changes
      </h3>
      <dl class="edit-review__list">
        {changes.ownerId !== undefined && (
          <div>
            <dt>Owner</dt>
            <dd class="figure">
              <span>{entry.ownerId}</span>
              <span aria-hidden="true">→</span>
              <span class="visually-hidden"> becomes </span>
              <OwnerDiff before={entry.ownerId} after={changes.ownerId} />
            </dd>
          </div>
        )}
        {changes.weeklyMedian !== undefined && (
          <div>
            <dt>Weekly median</dt>
            <dd class="figure">
              <span>{formatAmount(entry.weeklyMedian)}</span>
              <span aria-hidden="true">→</span>
              <span class="visually-hidden"> becomes </span>
              <span>
                {newMedianText(changes.weeklyMedian, medianText)} {abbreviation}
              </span>
            </dd>
          </div>
        )}
        {changes.active !== undefined && (
          <div>
            <dt>Status</dt>
            <dd>
              <span>{changes.active ? "Inactive" : "Active"}</span>
              <span aria-hidden="true">→</span>
              <span class="visually-hidden"> becomes </span>
              <span>{changes.active ? "Active" : "Inactive"}</span>
            </dd>
          </div>
        )}
      </dl>
      {changes.ownerId !== undefined && (
        <p class="edit-review__note">
          {abbreviation} moves to this person's Bot owner page. Check the
          underlined digits.
        </p>
      )}
      {resetsReserve && (
        <Notice tone="warning" title="This resets the reserve">
          <p>{resetWarning(changes.weeklyMedian, abbreviation)}</p>
        </Notice>
      )}
      {deactivates && (
        <Notice tone="warning" title={`This deactivates ${abbreviation}`}>
          <p>
            Every Pending transaction into or out of {abbreviation} is cancelled
            and runs back through the curve, and bots get a Cancelled webhook.
            Reactivating later doesn't bring them back.
          </p>
        </Notice>
      )}
      {changes.active === true && (
        <p class="edit-review__note">
          {abbreviation} comes back to the table, the ticker and the calculator.
        </p>
      )}
      <div class="form-actions">
        <Button
          variant={resetsReserve || deactivates ? "danger" : "primary"}
          disabled={pending}
          onClick={onSave}
        >
          {saveLabel(resetsReserve, deactivates)}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function newMedianText(median: number, medianText: string): string {
  return Number.isFinite(median) ? formatAmount(median) : medianText.trim();
}

function resetWarning(median: number, abbreviation: string): string {
  const lostTrades =
    "Trades since the last reset stop counting toward its value.";
  if (!(median > 0)) return lostTrades;

  return `The ${abbreviation} reserve goes to ${formatAmount(startingReserve(median))}. ${lostTrades}`;
}

function OwnerDiff({ before, after }: { before: string; after: string }) {
  const characters = [...after.trim()];

  return (
    <span>
      {characters.map((character, index) =>
        character === before[index] ? (
          character
        ) : (
          <span key={index} class="edit-review__changed">
            {character}
          </span>
        ),
      )}
    </span>
  );
}
