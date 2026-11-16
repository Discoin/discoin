import { useMemo } from "preact/hooks";
import { api } from "../../api/client.js";
import type { BotWithCurrencies } from "../../api/types.js";
import { BlockedUsers } from "../../components/blocking/BlockedUsers.jsx";
import { Panel } from "../../components/layout/Panel.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { useRequest } from "../../lib/useRequest.js";
import { ApiToken } from "./ApiToken.jsx";
import { PendingWebhooks } from "./PendingWebhooks.jsx";
import { WebhookForm } from "./WebhookForm.jsx";

export function BotSections({ bot }: { bot: BotWithCurrencies }) {
  const settings = useRequest(() => api.getBotSettings(bot.id), [bot.id]);
  const currencyStatesInPending = bot.currencies
    .map(({ abbreviation, active }) => `${abbreviation}:${active}`)
    .join(" ");
  const pending = useRequest(
    () => api.listPendingTransactions(bot.id),
    [bot.id, currencyStatesInPending],
  );
  const blockList = useMemo(() => api.botBlocks(bot.id), [bot.id]);

  return (
    <>
      <div class="page__columns">
        <Panel
          id="token"
          level={3}
          title="API token"
          description="The bot sends this with every request, for any of its currencies. Keep it secret."
        >
          <Loadable
            state={settings.state}
            label="the API token"
            onRetry={settings.reload}
          >
            {(loaded) => (
              <ApiToken botId={bot.id} hasToken={loaded.hasApiToken} />
            )}
          </Loadable>
        </Panel>
        <Panel
          id="webhook"
          level={3}
          title="Webhook"
          description="Get a receipt the moment a transaction comes into any of this bot's currencies, instead of polling."
        >
          <Loadable
            state={settings.state}
            label="the webhook"
            onRetry={settings.reload}
          >
            {(loaded) => (
              <WebhookForm
                botId={bot.id}
                initialUrl={loaded.webhookUrl}
                hasSecret={loaded.hasWebhookSecret}
              />
            )}
          </Loadable>
        </Panel>
      </div>
      <Panel
        id="pending"
        level={3}
        title="Pending transactions"
        description="Transactions into any of this bot's currencies that the bot hasn't marked Completed or Refunded yet."
      >
        <Loadable
          state={pending.state}
          label="pending transactions"
          onRetry={pending.reload}
        >
          {(transactions) => <PendingWebhooks pending={transactions} />}
        </Loadable>
      </Panel>
      <Panel
        id="blocked"
        level={3}
        title="Blocked users"
        description={`Blocked users can't trade into or out of any currency ${bot.name} runs. Blocking cancels their Pending transactions with those currencies.`}
      >
        <BlockedUsers blockList={blockList} scope={`from ${bot.name}`} />
      </Panel>
    </>
  );
}
