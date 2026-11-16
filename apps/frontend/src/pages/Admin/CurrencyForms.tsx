import { useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { AdminBot, AdminCurrency } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { parseAmount } from "../../lib/converter.js";
import { currencyValue, startingReserve } from "../../lib/exchange.js";
import {
  formatAmount,
  formatMultiplier,
  formatValue,
} from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";
import { BotSelect, NO_BOT_PICKED, pickedBot } from "./BotSelect.jsx";

const DEFAULT_RESERVE_MULTIPLIER = 10;
export const RESERVE_TOO_SMALL =
  "This median and multiplier give a reserve below 0.01. Raise one of them.";

interface ReserveInput {
  weeklyMedian: number;
  multiplier: number;
}

function reservePreview(input: ReserveInput, abbreviation: string): string {
  const { weeklyMedian, multiplier } = input;
  if (!(multiplier > 0)) {
    return "The reserve starts at the weekly median times the reserve multiplier.";
  }

  if (!(weeklyMedian > 0)) {
    return `The reserve starts at ${formatMultiplier(multiplier)} times the weekly median.`;
  }

  const reserve = startingReserve(weeklyMedian, multiplier);
  if (!(reserve > 0)) return RESERVE_TOO_SMALL;

  return `The reserve starts at ${formatAmount(reserve)} ${abbreviation}, so one ${abbreviation} starts with a value of ${formatValue(currencyValue(reserve))}.`;
}

interface AddCurrencyFormProps {
  bots: AdminBot[];
  onAdded: (added: AdminCurrency) => Promise<void>;
  onCancel: () => void;
}

export function AddCurrencyForm({
  bots,
  onAdded,
  onCancel,
}: AddCurrencyFormProps) {
  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [medianText, setMedianText] = useState("");
  const [multiplierText, setMultiplierText] = useState(
    String(DEFAULT_RESERVE_MULTIPLIER),
  );
  const [botId, setBotId] = useState(NO_BOT_PICKED);
  const action = useAction();
  const reserveInput = {
    weeklyMedian: parseAmount(medianText),
    multiplier: parseAmount(multiplierText),
  };

  function add(event: Event) {
    event.preventDefault();
    void action.run(async () => {
      const added = await api.addCurrency({
        name,
        abbreviation,
        ...reserveInput,
        botId: pickedBot(botId),
      });
      await onAdded(added);

      return `Added ${added.currency.name} (${added.currency.abbreviation}).`;
    });
  }

  return (
    <form class="form-stack" onSubmit={add}>
      <Field
        label="Currency name"
        value={name}
        error={action.fieldError("name")}
        onInput={(event) => setName(event.currentTarget.value)}
      />
      <Field
        label="Abbreviation"
        value={abbreviation}
        autoComplete="off"
        maxLength={4}
        hint="3 or 4 letters, A to Z, not used by another currency."
        error={action.fieldError("abbreviation")}
        onInput={(event) => setAbbreviation(event.currentTarget.value)}
      />
      <Field
        label="Weekly income median"
        inputMode="decimal"
        autoComplete="off"
        value={medianText}
        hint={reservePreview(reserveInput, abbreviation.trim().toUpperCase())}
        error={action.fieldError("weeklyMedian")}
        onInput={(event) => setMedianText(event.currentTarget.value)}
      />
      <Field
        label="Reserve multiplier"
        inputMode="decimal"
        autoComplete="off"
        value={multiplierText}
        hint="The reserve starts at the weekly median times this."
        error={action.fieldError("multiplier")}
        onInput={(event) => setMultiplierText(event.currentTarget.value)}
      />
      <BotSelect
        bots={bots}
        value={botId}
        error={action.fieldError("botId")}
        onChange={setBotId}
      />
      <div class="form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={action.state.status === "pending"}
        >
          Add currency
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ActionStatus
        state={action.state}
        inlineFields={[
          "name",
          "abbreviation",
          "weeklyMedian",
          "multiplier",
          "botId",
        ]}
      />
    </form>
  );
}
