import { api } from "../../api/client.js";
import { ShowOnceSecret, type ShowOnceCopy } from "./ShowOnceSecret.jsx";

const TOKEN_COPY: ShowOnceCopy = {
  label: "API token",
  missing: "This currency has no API token yet. Your bot needs one.",
  kept: "Your bot already has a token. Discoin only shows a token once, when it's made.",
  createLabel: "Create token",
  created: "Token created. Copy it into your bot's settings.",
  regenerated: "Token regenerated. Update your bot with the new one.",
  warning:
    "The old token stops working right away. Bots using it can't trade until you give them the new one.",
  confirmLabel: "Regenerate token",
  cancelLabel: "Keep current token",
};

interface ApiTokenProps {
  currencyId: string;
  hasToken: boolean;
}

export function ApiToken({ currencyId, hasToken }: ApiTokenProps) {
  return (
    <ShowOnceSecret
      exists={hasToken}
      issue={() => api.regenerateApiToken(currencyId)}
      copy={TOKEN_COPY}
    />
  );
}
