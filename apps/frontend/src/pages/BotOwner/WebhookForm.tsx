import { useState } from "preact/hooks";
import { api } from "../../api/client.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { useAction } from "../../lib/useAction.js";
import { ShowOnceSecret, type ShowOnceCopy } from "./ShowOnceSecret.jsx";
import { useUnsavedChanges } from "./unsavedChanges.js";
import { useWebhookTest } from "./useWebhookTest.js";

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
  dismissLabel: "I've copied the secret",
};

interface WebhookFormProps {
  botId: string;
  initialUrl: string | null;
  hasSecret: boolean;
}

export function WebhookForm({
  botId,
  initialUrl,
  hasSecret,
}: WebhookFormProps) {
  const [savedUrl, setSavedUrl] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl ?? "");
  const action = useAction();
  const test = useWebhookTest(botId);
  const isBusy =
    action.state.status === "pending" || test.state.status === "waiting";
  useUnsavedChanges("Webhook URL", {
    hasChanges: url.trim() !== (savedUrl ?? ""),
    isSaving: action.state.status === "pending",
  });

  function save(event: Event) {
    event.preventDefault();
    void action.run(async () => {
      await api.setWebhookUrl(botId, url);
      setSavedUrl(url.trim());

      return "Webhook saved. New transactions go to this URL.";
    });
  }

  function remove() {
    void action.run(async () => {
      await api.removeWebhookUrl(botId);
      setSavedUrl(null);
      setUrl("");

      return "Webhook removed. Your bot can still poll for transactions.";
    });
  }

  return (
    <div class="form-stack">
      <ShowOnceSecret
        exists={hasSecret}
        issue={() => api.generateWebhookSecret(botId)}
        copy={SECRET_COPY}
      />
      <form class="form-stack" onSubmit={save} noValidate>
        <Field
          label="Receipt webhook URL"
          type="url"
          value={url}
          placeholder="https://bot.example.com/discoin"
          hint="Discoin sends a signed request here for every transaction into any of this bot's currencies. With a webhook URL, events are sent to it and the event feed is switched off."
          error={action.fieldError("webhookUrl")}
          onInput={(event) => setUrl(event.currentTarget.value)}
        />
        <div class="form-actions">
          <Button type="submit" variant="primary" disabled={isBusy}>
            Save webhook
          </Button>
          <Button
            variant="secondary"
            disabled={isBusy}
            onClick={() => void test.run()}
          >
            Test
            <span class="visually-hidden">
              {savedUrl === null ? " event feed" : " webhook"}
            </span>
          </Button>
          {savedUrl !== null && (
            <Button variant="outline" disabled={isBusy} onClick={remove}>
              Remove webhook
            </Button>
          )}
        </div>
        <ActionStatus state={action.state} inlineFields={["webhookUrl"]} />
        <p
          class={
            test.state.status === "failed"
              ? "action-status action-status--failed"
              : "action-status"
          }
          role="status"
        >
          {test.state.message}
        </p>
      </form>
    </div>
  );
}
