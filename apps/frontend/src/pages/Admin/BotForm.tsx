import { useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { AdminBot, BotChanges, BotDetails } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { useAction } from "../../lib/useAction.js";

const BOT_FIELDS = ["name", "discordId", "ownerId"] as const;
const EMPTY_BOT: BotDetails = { name: "", discordId: "", ownerId: "" };
const OWNER_CHANGE_HINT =
  "The person who runs the bot. Changing the owner clears the bot's API token, webhook URL and webhook secret. Blocks stay.";
const NEW_OWNER_HINT =
  "The person who runs the bot. They get the Bot owner page for its currencies.";

interface BotFormProps {
  bot: AdminBot | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}

function changesOf(bot: AdminBot, details: BotDetails): BotChanges {
  return Object.fromEntries(
    BOT_FIELDS.filter((field) => details[field].trim() !== bot[field]).map(
      (field) => [field, details[field]],
    ),
  );
}

function detailsOf(bot: AdminBot | null): BotDetails {
  if (bot === null) return EMPTY_BOT;

  const { name, discordId, ownerId } = bot;

  return { name, discordId, ownerId };
}

function save(bot: AdminBot | null, details: BotDetails): Promise<AdminBot> {
  if (bot === null) return api.addBot(details);

  return api.updateBot(bot.id, changesOf(bot, details));
}

export function BotForm({ bot, onSaved, onCancel }: BotFormProps) {
  const [details, setDetails] = useState(detailsOf(bot));
  const action = useAction();
  const submitLabel = bot === null ? "Add bot" : "Save bot";

  function edit(field: keyof BotDetails) {
    return (event: { currentTarget: HTMLInputElement }) =>
      setDetails({ ...details, [field]: event.currentTarget.value });
  }

  function submit(event: Event) {
    event.preventDefault();
    void action.run(async () => {
      const saved = await save(bot, details);
      await onSaved();

      return `Saved ${saved.name}.`;
    });
  }

  return (
    <form class="form-stack" onSubmit={submit}>
      <Field
        label="Bot name"
        value={details.name}
        autoComplete="off"
        error={action.fieldError("name")}
        onInput={edit("name")}
      />
      <Field
        label="Bot's Discord ID"
        inputMode="numeric"
        autoComplete="off"
        value={details.discordId}
        hint="The bot's own Discord user ID, not its owner's."
        error={action.fieldError("discordId")}
        onInput={edit("discordId")}
      />
      <Field
        label="Owner ID"
        inputMode="numeric"
        autoComplete="off"
        value={details.ownerId}
        hint={bot === null ? NEW_OWNER_HINT : OWNER_CHANGE_HINT}
        error={action.fieldError("ownerId")}
        onInput={edit("ownerId")}
      />
      <div class="form-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={action.state.status === "pending"}
        >
          {submitLabel}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ActionStatus state={action.state} inlineFields={[...BOT_FIELDS]} />
    </form>
  );
}
