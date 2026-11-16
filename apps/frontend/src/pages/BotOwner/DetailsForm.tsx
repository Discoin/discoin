import { useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { Currency } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { useAction } from "../../lib/useAction.js";
import { noticingDeactivation } from "./inactiveRefusal.js";
import { useUnsavedChanges } from "./unsavedChanges.js";

interface DetailsFormProps {
  currency: Currency;
  onSaved: (currency: Currency) => void;
  onDeactivated: () => void;
}

export function DetailsForm({
  currency,
  onSaved,
  onDeactivated,
}: DetailsFormProps) {
  const [name, setName] = useState(currency.name);
  const [abbreviation, setAbbreviation] = useState(currency.abbreviation);
  const action = useAction();
  useUnsavedChanges("Name and abbreviation", {
    hasChanges:
      name !== currency.name || abbreviation !== currency.abbreviation,
    isSaving: action.state.status === "pending",
  });

  function save(event: Event) {
    event.preventDefault();
    void action.run(async () => {
      const updated = await noticingDeactivation(
        api.updateCurrencyDetails(currency.id, { name, abbreviation }),
        onDeactivated,
      );
      setName(updated.name);
      setAbbreviation(updated.abbreviation);
      onSaved(updated);

      return `Saved. Your currency is now ${updated.name} (${updated.abbreviation}).`;
    });
  }

  return (
    <form class="form-stack" onSubmit={save}>
      <Field
        label="Currency name"
        value={name}
        hint="Shown on the dashboard and in receipts."
        error={action.fieldError("name")}
        onInput={(event) => setName(event.currentTarget.value)}
      />
      <Field
        label="Abbreviation"
        value={abbreviation}
        autoComplete="off"
        maxLength={4}
        hint="3 or 4 letters, A to Z. Bots and users type this to pick your currency, and no two currencies share one."
        error={action.fieldError("abbreviation")}
        onInput={(event) => setAbbreviation(event.currentTarget.value)}
      />
      <div class="form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={action.state.status === "pending"}
        >
          Save changes
        </Button>
      </div>
      <ActionStatus
        state={action.state}
        inlineFields={["name", "abbreviation"]}
      />
    </form>
  );
}
