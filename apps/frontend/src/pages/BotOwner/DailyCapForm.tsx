import { useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { Currency } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { Switch } from "../../components/shared/Switch.jsx";
import { parseAmount } from "../../lib/converter.js";
import { formatAmount } from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";
import { noticingDeactivation } from "./inactiveRefusal.js";
import { useUnsavedChanges } from "./unsavedChanges.js";

interface DailyCapFormProps {
  currency: Currency;
  initialCap: number | null;
  onDeactivated: () => void;
}

interface CapChoice {
  limited: boolean;
  capText: string;
}

function choiceOf(cap: number | null): CapChoice {
  return { limited: cap !== null, capText: cap === null ? "" : String(cap) };
}

export function DailyCapForm({
  currency,
  initialCap,
  onDeactivated,
}: DailyCapFormProps) {
  const [saved, setSaved] = useState(() => choiceOf(initialCap));
  const [limited, setLimited] = useState(saved.limited);
  const [capText, setCapText] = useState(saved.capText);
  const action = useAction();
  useUnsavedChanges("Daily cap", {
    hasChanges:
      limited !== saved.limited || (limited && capText !== saved.capText),
    isSaving: action.state.status === "pending",
  });

  async function saveCap(): Promise<string> {
    const cap = parseAmount(capText);
    await noticingDeactivation(
      api.setDailyCap(currency.id, cap),
      onDeactivated,
    );
    setSaved({ limited: true, capText });

    return `Each user can now receive up to ${formatAmount(cap)} ${currency.abbreviation} per day.`;
  }

  async function removeCap(): Promise<string> {
    await noticingDeactivation(api.removeDailyCap(currency.id), onDeactivated);
    setSaved({ limited: false, capText });

    return "Daily cap removed. Users can receive any amount.";
  }

  function save(event: Event) {
    event.preventDefault();
    void action.run(limited ? saveCap : removeCap);
  }

  return (
    <form class="form-stack" onSubmit={save}>
      <Switch
        label="Limit how much one user can receive per day"
        checked={limited}
        onChange={setLimited}
      />
      {limited && (
        <Field
          label="Daily cap per user"
          inputMode="decimal"
          autoComplete="off"
          value={capText}
          suffix={currency.abbreviation}
          hint="Counts the last 24 hours of Pending and Completed transactions. A bigger trade is turned down, with the most the user can still send."
          error={action.fieldError("dailyCap")}
          onInput={(event) => setCapText(event.currentTarget.value)}
        />
      )}
      <div class="form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={action.state.status === "pending"}
        >
          Save daily cap
        </Button>
      </div>
      <ActionStatus state={action.state} inlineFields={["dailyCap"]} />
    </form>
  );
}
