import { useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { AdminCurrency } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { parseAmount } from "../../lib/converter.js";
import {
  RESERVE_PER_WEEKLY_MEDIAN,
  currencyValue,
  startingReserve,
} from "../../lib/exchange.js";
import { formatAmount, formatValue } from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";

function reservePreview(medianText: string, abbreviation: string): string {
  const median = parseAmount(medianText);
  if (!(median > 0)) {
    return `The reserve starts at ${RESERVE_PER_WEEKLY_MEDIAN} times the weekly median.`;
  }

  const reserve = startingReserve(median);

  return `The reserve starts at ${formatAmount(reserve)} ${abbreviation}, so one ${abbreviation} starts with a value of ${formatValue(currencyValue(reserve))}.`;
}

interface AddCurrencyFormProps {
  onAdded: (added: AdminCurrency) => void;
  onCancel: () => void;
}

export function AddCurrencyForm({ onAdded, onCancel }: AddCurrencyFormProps) {
  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [medianText, setMedianText] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const action = useAction();

  function add(event: Event) {
    event.preventDefault();
    void action.run(async () => {
      const added = await api.addCurrency({
        name,
        abbreviation,
        weeklyMedian: parseAmount(medianText),
        ownerId,
      });
      onAdded(added);

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
        hint={reservePreview(medianText, abbreviation.trim().toUpperCase())}
        error={action.fieldError("weeklyMedian")}
        onInput={(event) => setMedianText(event.currentTarget.value)}
      />
      <Field
        label="Owner ID"
        inputMode="numeric"
        autoComplete="off"
        value={ownerId}
        hint="The person who runs the bot, not the bot itself. They get the Bot owner page for this currency."
        error={action.fieldError("ownerId")}
        onInput={(event) => setOwnerId(event.currentTarget.value)}
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
        inlineFields={["name", "abbreviation", "weeklyMedian", "ownerId"]}
      />
    </form>
  );
}
