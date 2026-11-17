import type {
  BlockState,
  BotBlockCause,
  BotLabel,
  SiteWideBlockCause,
  TransactionCause,
} from "../../api/types.js";

const NO_BLOCK = "Not caused by a block. The reason isn't recorded.";
const SITE_WIDE = "Blocked site wide by Discoin admins.";
const STATE_NOTES: Partial<Record<BlockState, string>> = {
  lifted: "This block has since been lifted.",
  merged: "This block was merged into another block for the same bot.",
};

function botNameText(bot: BotLabel): string {
  return bot.removed ? `${bot.name} (removed)` : bot.name;
}

function headlineOf(cause: SiteWideBlockCause | BotBlockCause): string {
  if (cause.kind === "global") return SITE_WIDE;

  return `Blocked by the bot owner of ${botNameText(cause.bot)}.`;
}

export function CauseText({ cause }: { cause: TransactionCause }) {
  if (cause.kind === "none") return <p>{NO_BLOCK}</p>;

  const note = STATE_NOTES[cause.state];

  return (
    <>
      <p>{headlineOf(cause)}</p>
      {cause.reason !== undefined && <p>Reason: {cause.reason}</p>}
      {note !== undefined && <p>{note}</p>}
    </>
  );
}
