import type { AdminBot } from "../../api/types.js";
import { Select } from "../../components/shared/Select.jsx";

export const NO_BOT_PICKED = "";

interface BotSelectProps {
  bots: AdminBot[];
  value: string;
  error: string | undefined;
  onChange: (botId: string) => void;
}

export function BotSelect({ bots, value, error, onChange }: BotSelectProps) {
  return (
    <Select
      label="Bot"
      value={value}
      hint="The bot that runs this currency. It can't be changed once saved."
      error={error}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value={NO_BOT_PICKED} disabled>
        Pick a bot
      </option>
      {bots.map((bot) => (
        <option key={bot.id} value={bot.id}>
          {bot.name}
        </option>
      ))}
    </Select>
  );
}

export function pickedBot(botId: string): string | null {
  return botId === NO_BOT_PICKED ? null : botId;
}
