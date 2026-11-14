import { useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { AdminCurrency } from "../../api/types.js";
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
import { AddCurrencyForm } from "./CurrencyForms.jsx";
import { EditCurrencyForm } from "./EditCurrencyForm.jsx";
import "../../components/shared/DataTable.scss";
import "./style.scss";

type OpenDialog =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; currencyId: string };

interface CurrencyOverviewProps {
  currencies: AdminCurrency[];
  onEdit: (currencyId: string) => void;
}

function CurrencyOverview({ currencies, onEdit }: CurrencyOverviewProps) {
  return (
    <TableFrame label="All currencies">
      <table class="data-table">
        <caption class="visually-hidden">All currencies</caption>
        <thead>
          <tr>
            <th scope="col">Currency</th>
            <th scope="col">Edit</th>
            <th scope="col">Status</th>
            <th scope="col" class="data-table__number">
              Value
            </th>
            <th scope="col" class="data-table__number">
              Reserve
            </th>
            <th scope="col" class="data-table__number">
              Weekly median
            </th>
            <th scope="col" class="data-table__number">
              Owner
            </th>
          </tr>
        </thead>
        <tbody>
          {currencies.map(({ currency, weeklyMedian, ownerId }) => (
            <tr key={currency.id}>
              <td>
                <CurrencyTag currency={currency} />
              </td>
              <td>
                <Button variant="outline" onClick={() => onEdit(currency.id)}>
                  <span>
                    <svg
                      class="admin__pencil"
                      viewBox="0 0 16 16"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5z" />
                    </svg>
                    Edit
                  </span>
                  <span class="visually-hidden"> {currency.abbreviation}</span>
                </Button>
              </td>
              <td>
                <span class="admin__status">
                  {currency.active ? "Active" : "Inactive"}
                </span>
              </td>
              <td class="data-table__number">
                {formatValue(currencyValue(currency.reserve))}
              </td>
              <td class="data-table__number">
                {formatAmount(currency.reserve)}
              </td>
              <td class="data-table__number">{formatAmount(weeklyMedian)}</td>
              <td class="data-table__number">{ownerId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function replaced(
  currencies: AdminCurrency[],
  updated: AdminCurrency,
): AdminCurrency[] {
  return currencies.map((entry) =>
    entry.currency.id === updated.currency.id ? updated : entry,
  );
}

function findEntry(currencies: AdminCurrency[], id: string): AdminCurrency {
  const entry = currencies.find((candidate) => candidate.currency.id === id);
  if (entry === undefined) throw new Error(`Unknown currency "${id}"`);

  return entry;
}

interface CurrencyEditorProps {
  currencies: AdminCurrency[];
  onChange: (currencies: AdminCurrency[]) => void;
}

function CurrencyEditor({ currencies, onChange }: CurrencyEditorProps) {
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "closed" });
  const close = () => setDialog({ kind: "closed" });

  function finish(updated: AdminCurrency[]) {
    onChange(updated);
    close();
  }

  return (
    <Panel id="overview" title="All currencies">
      <div class="admin__toolbar">
        <Button variant="primary" onClick={() => setDialog({ kind: "add" })}>
          Add currency
        </Button>
      </div>
      {currencies.length === 0 ? (
        <EmptyState title="No currencies yet">
          <p>Add the first one with the button above.</p>
        </EmptyState>
      ) : (
        <CurrencyOverview
          currencies={currencies}
          onEdit={(currencyId) => setDialog({ kind: "edit", currencyId })}
        />
      )}
      {dialog.kind === "add" && (
        <Dialog title="Add a currency" onClose={close}>
          <AddCurrencyForm
            onAdded={(added) => finish([...currencies, added])}
            onCancel={close}
          />
        </Dialog>
      )}
      {dialog.kind === "edit" && (
        <EditDialog
          entry={findEntry(currencies, dialog.currencyId)}
          onSaved={(updated) => finish(replaced(currencies, updated))}
          onClose={close}
        />
      )}
    </Panel>
  );
}

interface EditDialogProps {
  entry: AdminCurrency;
  onSaved: (updated: AdminCurrency) => void;
  onClose: () => void;
}

function EditDialog({ entry, onSaved, onClose }: EditDialogProps) {
  const { name, abbreviation } = entry.currency;

  return (
    <Dialog title={`Edit ${name} (${abbreviation})`} onClose={onClose}>
      <EditCurrencyForm entry={entry} onSaved={onSaved} onCancel={onClose} />
    </Dialog>
  );
}

function CurrencyAdmin() {
  const request = useRequest(() => api.listAdminCurrencies(), []);

  return (
    <Loadable state={request.state} label="currencies" onRetry={request.reload}>
      {(currencies) => (
        <CurrencyEditor currencies={currencies} onChange={request.update} />
      )}
    </Loadable>
  );
}

export function Admin() {
  usePageTitle("Admin");

  return (
    <div class="page">
      <PageIntro title="Admin">
        Add currencies, reset reserves and manage who can trade across all of
        Discoin.
      </PageIntro>
      <RequireLogin access="admin">{() => <AdminWorkspace />}</RequireLogin>
    </div>
  );
}

function AdminWorkspace() {
  return (
    <>
      <CurrencyAdmin />
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
