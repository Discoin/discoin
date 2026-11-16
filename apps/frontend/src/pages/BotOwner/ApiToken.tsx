import { api } from "../../api/client.js";
import { ShowOnceSecret, type ShowOnceCopy } from "./ShowOnceSecret.jsx";

const TOKEN_COPY: ShowOnceCopy = {
  label: "API token",
  missing: "This bot has no API token yet. It needs one to trade.",
  kept: "Your bot already has a token. Discoin only shows a token once, when it's made.",
  createLabel: "Create token",
  created: "Token created. Copy it into your bot's settings.",
  regenerated: "Token regenerated. Update your bot with the new one.",
  warning:
    "The old token stops working right away. Your bot can't trade until you give it the new one.",
  confirmLabel: "Regenerate token",
  cancelLabel: "Keep current token",
  dismissLabel: "I've copied the token",
};

interface ApiTokenProps {
  botId: string;
  hasToken: boolean;
}

export function ApiToken({ botId, hasToken }: ApiTokenProps) {
  return (
    <ShowOnceSecret
      exists={hasToken}
      issue={() => api.regenerateApiToken(botId)}
      copy={TOKEN_COPY}
    />
  );
}
