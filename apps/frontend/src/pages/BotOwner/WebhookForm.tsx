import { useState } from "preact/hooks";
import { api } from "../../api/client.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { useAction } from "../../lib/useAction.js";
import { ShowOnceSecret, type ShowOnceCopy } from "./ShowOnceSecret.jsx";

const SECRET_COPY: ShowOnceCopy = {
  label: "Webhook secret",
  missing:
    "Discoin signs every webhook with a secret, so your bot can check it came from Discoin. Generate one before adding a URL.",
  kept: "Your bot already has a webhook secret. Discoin only shows a secret once, when it's made.",
  createLabel: "Generate webhook secret",
  created:
    "Webhook secret created. Copy it into your bot so it can check signatures.",
  regenerated: "Webhook secret regenerated. Update your bot with the new one.",
  warning:
    "The old secret stops signing right away. Your bot rejects new webhooks until it has the new secret.",
  confirmLabel: "Regenerate secret",
  cancelLabel: "Keep current secret",
};

interface WebhookFormProps {
  currencyId: string;
  initialUrl: string | null;
  hasSecret: boolean;
}

export function WebhookForm({
  currencyId,
  initialUrl,
  hasSecret,
}: WebhookFormProps) {
  const [savedUrl, setSavedUrl] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl ?? "");
  const action = useAction();

  function save(event: Event) {
    event.preventDefault();
    void action.run(async () => {
      await api.setWebhookUrl(currencyId, url);
      setSavedUrl(url.trim());

      return "Webhook saved. New transactions go to this URL.";
    });
  }

  function sendTest() {
    void action.run(async () => {
      const status = await api.testWebhook(currencyId);

      return `Test sent. Your webhook answered ${status}.`;
    });
  }

  function remove() {
    void action.run(async () => {
      await api.removeWebhookUrl(currencyId);
      setSavedUrl(null);
      setUrl("");

      return "Webhook removed. Your bot can still poll for transactions.";
    });
  }

  return (
    <div class="form-stack">
      <ShowOnceSecret
        exists={hasSecret}
        issue={() => api.generateWebhookSecret(currencyId)}
        copy={SECRET_COPY}
      />
      <form class="form-stack" onSubmit={save} noValidate>
        <Field
          label="Receipt webhook URL"
          type="url"
          value={url}
          placeholder="https://bot.example.com/discoin"
          hint="Discoin sends a signed request here for every transaction into your currency."
          error={action.fieldError("webhookUrl")}
          onInput={(event) => setUrl(event.currentTarget.value)}
        />
        <div class="form-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={action.state.status === "pending"}
          >
            Save webhook
          </Button>
          {savedUrl !== null && (
            <>
              <Button
                variant="secondary"
                disabled={action.state.status === "pending"}
                onClick={sendTest}
              >
                Test<span class="visually-hidden"> webhook</span>
              </Button>
              <Button
                variant="outline"
                disabled={action.state.status === "pending"}
                onClick={remove}
              >
                Remove webhook
              </Button>
            </>
          )}
        </div>
        <ActionStatus state={action.state} inlineFields={["webhookUrl"]} />
      </form>
    </div>
  );
}
