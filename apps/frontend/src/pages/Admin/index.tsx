import { useRef, useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { AdminBot, AdminCurrency } from "../../api/types.js";
import { BlockedUsers } from "../../components/blocking/BlockedUsers.jsx";
import { RequireLogin } from "../../components/session/RequireLogin.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { CurrencyTag } from "../../components/currency/CurrencyTag.jsx";
import { Dialog } from "../../components/shared/Dialog.jsx";
import { EmptyState } from "../../components/shared/EmptyState.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { PageIntro } from "../../components/layout/PageIntro.jsx";
import { Panel } from "../../components/layout/Panel.jsx";
import { TableFrame } from "../../components/shared/TableFrame.jsx";
import { currencyValue } from "../../lib/exchange.js";
import { formatAmount, formatValue } from "../../lib/format.js";
import { usePageTitle } from "../../lib/usePageTitle.js";
import { useRequest } from "../../lib/useRequest.js";
import { Admins } from "./Admins.jsx";
import { Bots } from "./Bots.jsx";
import { AddCurrencyForm } from "./CurrencyForms.jsx";
import { EditCurrencyForm } from "./EditCurrencyForm.jsx";
import { RemovalDialog } from "./RemovalDialog.jsx";
import { EditButton, RemoveButton } from "./RowButtons.jsx";
import { useFocusAfterClose } from "./useFocusAfterClose.js";
import "../../components/shared/DataTable.scss";
import "./style.scss";

type OpenDialog =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; entry: AdminCurrency }
  | { kind: "remove"; entry: AdminCurrency };

interface AdminData {
  currencies: AdminCurrency[];
  bots: AdminBot[];
}

async function loadAdminData(): Promise<AdminData> {
  const [currencies, bots] = await Promise.all([
    api.listAdminCurrencies(),
    api.listAdminBots(),
  ]);

  return { currencies, bots };
}

function labelOf({ currency }: AdminCurrency): string {
  return `${currency.name} (${currency.abbreviation})`;
}

interface CurrencyOverviewProps {
  currencies: AdminCurrency[];
  onEdit: (entry: AdminCurrency) => void;
  onRemove: (entry: AdminCurrency) => void;
}

function CurrencyOverview({
  currencies,
  onEdit,
  onRemove,
}: CurrencyOverviewProps) {
  return (
    <TableFrame label="All currencies">
      <table class="data-table">
        <caption class="visually-hidden">All currencies</caption>
        <thead>
          <tr>
            <th scope="col">Currency</th>
            <th scope="col">Edit</th>
            <th scope="col">Remove</th>
            <th scope="col">Status</th>
            <th scope="col">Bot</th>
            <th scope="col" class="data-table__number">
              Value
            </th>
            <th scope="col" class="data-table__number">
              Reserve
            </th>
            <th scope="col" class="data-table__number">
              Weekly median
            </th>
          </tr>
        </thead>
        <tbody>
          {currencies.map((entry) => {
            const { currency, weeklyMedian, bot } = entry;

            return (
              <tr key={currency.id}>
                <td>
                  <CurrencyTag currency={currency} />
                </td>
                <td>
                  <EditButton
                    subject={currency.abbreviation}
                    onClick={() => onEdit(entry)}
                  />
                </td>
                <td>
                  <RemoveButton
                    subject={currency.abbreviation}
                    onClick={() => onRemove(entry)}
                  />
                </td>
                <td>
                  <span class="admin__status">
                    {currency.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  {bot === null ? (
                    <span class="admin__status">No bot</span>
                  ) : (
                    bot.name
                  )}
                </td>
                <td class="data-table__number">
                  {formatValue(currencyValue(currency.reserve))}
                </td>
                <td class="data-table__number">
                  {formatAmount(currency.reserve)}
                </td>
                <td class="data-table__number">{formatAmount(weeklyMedian)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}

interface CurrencyEditorProps {
  data: AdminData;
  onChange: () => Promise<void>;
}

function CurrencyEditor({ data, onChange }: CurrencyEditorProps) {
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "closed" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useFocusAfterClose(headingRef);
  const close = () => setDialog({ kind: "closed" });
  const { currencies, bots } = data;

  async function finish() {
    await onChange();
    close();
  }

  async function finishRemoval() {
    await finish();
    focusHeading();
  }

  return (
    <Panel id="overview" title="All currencies" headingRef={headingRef}>
      <div class="admin__toolbar">
        <Button
          variant="primary"
          disabled={bots.length === 0}
          onClick={() => setDialog({ kind: "add" })}
        >
          Add currency
        </Button>
        {bots.length === 0 && (
          <p class="edit-form__hint">
            Add a bot first. Every currency needs one.
          </p>
        )}
      </div>
      {currencies.length === 0 ? (
        <EmptyState title="No currencies yet">
          <p>Add the first one with the button above.</p>
        </EmptyState>
      ) : (
        <CurrencyOverview
          currencies={currencies}
          onEdit={(entry) => setDialog({ kind: "edit", entry })}
          onRemove={(entry) => setDialog({ kind: "remove", entry })}
        />
      )}
      {dialog.kind === "add" && (
        <Dialog title="Add a currency" onClose={close}>
          <AddCurrencyForm bots={bots} onAdded={finish} onCancel={close} />
        </Dialog>
      )}
      {dialog.kind === "edit" && (
        <Dialog title={`Edit ${labelOf(dialog.entry)}`} onClose={close}>
          <EditCurrencyForm
            entry={dialog.entry}
            bots={bots}
            onSaved={finish}
            onCancel={close}
          />
        </Dialog>
      )}
      {dialog.kind === "remove" && (
        <RemovalDialog
          subject={{
            kind: "currency",
            name: labelOf(dialog.entry),
            preview: () => api.previewCurrencyRemoval(dialog.entry.currency.id),
            remove: () => api.removeCurrency(dialog.entry.currency.id),
          }}
          onRemoved={finishRemoval}
          onClose={close}
        />
      )}
    </Panel>
  );
}

export function Admin() {
  usePageTitle("Admin");

  return (
    <div class="page">
      <PageIntro title="Admin">
        Register bots, add currencies, reset reserves and manage who can trade
        across all of Discoin.
      </PageIntro>
      <RequireLogin access="admin">{() => <AdminWorkspace />}</RequireLogin>
    </div>
  );
}

function AdminWorkspace() {
  const request = useRequest(loadAdminData, []);

  async function refresh() {
    request.update(await loadAdminData());
  }

  return (
    <>
      <Loadable
        state={request.state}
        label="currencies and bots"
        onRetry={request.reload}
      >
        {(data) => (
          <>
            <CurrencyEditor data={data} onChange={refresh} />
            <Panel
              id="bots"
              title="Bots"
              description="Each currency belongs to one bot, and the bot's owner manages it on the Bot owner page."
            >
              <Bots bots={data.bots} onChange={refresh} />
            </Panel>
          </>
        )}
      </Loadable>
      <Panel
        id="blocked"
        title="Blocked everywhere"
        description="Blocked users can't trade in any currency. Blocking cancels their Pending transactions."
      >
        <BlockedUsers blockList={api.globalBlocks} scope="everywhere" />
      </Panel>
      <Panel
        id="admins"
        title="Admins"
        description="Admins can see and change everything on this page."
      >
        <Admins />
      </Panel>
    </>
  );
}
