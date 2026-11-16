import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type {
  AdminBot,
  AdminCurrency,
  CurrencyChanges,
  SavedCurrency,
} from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { Notice } from "../../components/shared/Notice.jsx";
import { Switch } from "../../components/shared/Switch.jsx";
import { parseAmount } from "../../lib/converter.js";
import { startingReserve } from "../../lib/exchange.js";
import {
  formatAmount,
  formatBlockCount,
  formatMultiplier,
} from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";
import { BotSelect, NO_BOT_PICKED, pickedBot } from "./BotSelect.jsx";
import { RESERVE_TOO_SMALL } from "./CurrencyForms.jsx";

type Step = "edit" | "review";

interface EditCurrencyFormProps {
  entry: AdminCurrency;
  bots: AdminBot[];
  onSaved: (updated: AdminCurrency) => Promise<void>;
  onCancel: () => void;
}

interface FormValues {
  botId: string;
  medianText: string;
  multiplierText: string;
  active: boolean;
}

function changesOf(entry: AdminCurrency, values: FormValues): CurrencyChanges {
  const changes: CurrencyChanges = {};
  const botId = pickedBot(values.botId);
  if (botId !== null) changes.botId = botId;

  const median = parseAmount(values.medianText);
  const multiplier = parseAmount(values.multiplierText);
  if (median !== entry.weeklyMedian) changes.weeklyMedian = median;
  if (multiplier !== entry.multiplier) changes.multiplier = multiplier;
  if (values.active !== entry.currency.active) changes.active = values.active;

  return changes;
}

function hasChanges(changes: CurrencyChanges): boolean {
  return Object.keys(changes).length > 0;
}

function onlyAssignsBot(changes: CurrencyChanges): boolean {
  const changed = Object.keys(changes);

  return changed.length === 1 && changed[0] === "botId";
}

function saveLabel(resetsReserve: boolean, deactivates: boolean): string {
  if (resetsReserve && deactivates) return "Reset reserve, deactivate and save";
  if (resetsReserve) return "Reset reserve and save";
  if (deactivates) return "Deactivate and save";

  return "Save changes";
}

function savedMessage(abbreviation: string, result: SavedCurrency): string {
  const { saved, movedBlocks } = result;
  if (movedBlocks === 0 || saved.bot === null) return `Saved ${abbreviation}.`;

  return `Saved ${abbreviation}. Moved ${formatBlockCount(movedBlocks)} to ${saved.bot.name}.`;
}

export function EditCurrencyForm({
  entry,
  bots,
  onSaved,
  onCancel,
}: EditCurrencyFormProps) {
  const [botId, setBotId] = useState(NO_BOT_PICKED);
  const [medianText, setMedianText] = useState(String(entry.weeklyMedian));
  const [multiplierText, setMultiplierText] = useState(
    String(entry.multiplier),
  );
  const [active, setActive] = useState(entry.currency.active);
  const [step, setStep] = useState<Step>("edit");
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const changes = changesOf(entry, {
    botId,
    medianText,
    multiplierText,
    active,
  });
  const savesDirectly = onlyAssignsBot(changes);
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
      const result = await api.updateCurrency(entry.currency.id, changes);
      await onSaved(result.saved);

      return savedMessage(abbreviation, result);
    });
  }

  return (
    <form
      ref={formRef}
      class="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (savesDirectly) save();
        else setStep("review");
      }}
    >
      {step === "edit" ? (
        <>
          {entry.bot === null ? (
            <BotSelect
              bots={bots}
              value={botId}
              error={action.fieldError("botId")}
              onChange={setBotId}
            />
          ) : (
            <dl class="edit-form__fixed">
              <dt>Bot</dt>
              <dd>{entry.bot.name}</dd>
            </dl>
          )}
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
          <Field
            label="Reserve multiplier"
            inputMode="decimal"
            autoComplete="off"
            value={multiplierText}
            hint="Changing it resets the reserve to the weekly median times this."
            error={action.fieldError("multiplier")}
            onInput={(event) => setMultiplierText(event.currentTarget.value)}
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
              disabled={
                !hasChanges(changes) || action.state.status === "pending"
              }
            >
              {savesDirectly ? "Save changes" : "Review changes"}
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Review
          entry={entry}
          bots={bots}
          changes={changes}
          texts={{ medianText, multiplierText }}
          pending={action.state.status === "pending"}
          onBack={() => setStep("edit")}
          onSave={save}
        />
      )}
      <ActionStatus
        state={action.state}
        inlineFields={["botId", "weeklyMedian", "multiplier"]}
      />
    </form>
  );
}

interface ReserveTexts {
  medianText: string;
  multiplierText: string;
}

interface ReviewProps {
  entry: AdminCurrency;
  bots: AdminBot[];
  changes: CurrencyChanges;
  texts: ReserveTexts;
  pending: boolean;
  onBack: () => void;
  onSave: () => void;
}

function botNamed(bots: AdminBot[], botId: string): string {
  const bot = bots.find((candidate) => candidate.id === botId);
  if (bot === undefined) throw new Error(`Unknown bot "${botId}"`);

  return bot.name;
}

function Review({
  entry,
  bots,
  changes,
  texts,
  pending,
  onBack,
  onSave,
}: ReviewProps) {
  const { abbreviation } = entry.currency;
  const resetsReserve =
    changes.weeklyMedian !== undefined || changes.multiplier !== undefined;
  const deactivates = changes.active === false;
  const newTerms = {
    weeklyMedian: changes.weeklyMedian ?? entry.weeklyMedian,
    multiplier: changes.multiplier ?? entry.multiplier,
  };

  return (
    <div class="edit-review">
      <h3 class="edit-review__title" tabIndex={-1}>
        Review {abbreviation} changes
      </h3>
      <dl class="edit-review__list">
        {changes.botId !== undefined && (
          <div>
            <dt>Bot</dt>
            <dd>
              <span>No bot</span>
              <span aria-hidden="true">→</span>
              <span class="visually-hidden"> becomes </span>
              <span>{botNamed(bots, changes.botId)}</span>
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
                {typedText(texts.medianText, formatAmount)} {abbreviation}
              </span>
            </dd>
          </div>
        )}
        {changes.multiplier !== undefined && (
          <div>
            <dt>Reserve multiplier</dt>
            <dd class="figure">
              <span>{formatMultiplier(entry.multiplier)}</span>
              <span aria-hidden="true">→</span>
              <span class="visually-hidden"> becomes </span>
              <span>{typedText(texts.multiplierText, formatMultiplier)}</span>
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
      {changes.botId !== undefined && (
        <p class="edit-review__note">
          {abbreviation} moves to the Bot owner page of this bot's owner, and
          its blocks move to the bot. The bot can't be changed later.
        </p>
      )}
      {resetsReserve && (
        <Notice tone="warning" title="This resets the reserve">
          <p>{resetWarning(newTerms, abbreviation)}</p>
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

function typedText(text: string, format: (typed: number) => string): string {
  const typed = parseAmount(text);

  return Number.isFinite(typed) ? format(typed) : text.trim();
}

interface ReserveTerms {
  weeklyMedian: number;
  multiplier: number;
}

function resetWarning(terms: ReserveTerms, abbreviation: string): string {
  const lostTrades =
    "Trades since the last reset stop counting toward its value.";
  if (!(terms.weeklyMedian > 0 && terms.multiplier > 0)) return lostTrades;

  const reserve = startingReserve(terms.weeklyMedian, terms.multiplier);
  if (!(reserve > 0)) return RESERVE_TOO_SMALL;

  return `The ${abbreviation} reserve goes to ${formatAmount(reserve)}. ${lostTrades}`;
}
