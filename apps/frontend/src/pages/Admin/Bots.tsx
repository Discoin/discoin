import { useRef, useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { AdminBot } from "../../api/types.js";
import { Button } from "../../components/shared/Button.jsx";
import { Dialog } from "../../components/shared/Dialog.jsx";
import { EmptyState } from "../../components/shared/EmptyState.jsx";
import { TableFrame } from "../../components/shared/TableFrame.jsx";
import { formatQuantity } from "../../lib/format.js";
import { BotForm } from "./BotForm.jsx";
import { RemovalDialog } from "./RemovalDialog.jsx";
import { EditButton, RemoveButton } from "./RowButtons.jsx";
import { useFocusAfterClose } from "./useFocusAfterClose.js";
import "../../components/shared/DataTable.scss";

type OpenDialog =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; bot: AdminBot }
  | { kind: "remove"; bot: AdminBot };

interface BotsProps {
  bots: AdminBot[];
  onChange: () => Promise<void>;
}

export function Bots({ bots, onChange }: BotsProps) {
  const [dialog, setDialog] = useState<OpenDialog>({ kind: "closed" });
  const addRef = useRef<HTMLButtonElement>(null);
  const focusAdd = useFocusAfterClose(addRef);
  const close = () => setDialog({ kind: "closed" });

  async function finish() {
    await onChange();
    close();
  }

  async function finishRemoval() {
    await finish();
    focusAdd();
  }

  return (
    <>
      <div class="admin__toolbar">
        <Button
          ref={addRef}
          variant="primary"
          onClick={() => setDialog({ kind: "add" })}
        >
          Add bot
        </Button>
      </div>
      {bots.length === 0 ? (
        <EmptyState title="No bots yet">
          <p>Add a bot before adding its currency.</p>
        </EmptyState>
      ) : (
        <BotTable
          bots={bots}
          onEdit={(bot) => setDialog({ kind: "edit", bot })}
          onRemove={(bot) => setDialog({ kind: "remove", bot })}
        />
      )}
      {dialog.kind === "add" && (
        <Dialog title="Add a bot" onClose={close}>
          <BotForm bot={null} onSaved={finish} onCancel={close} />
        </Dialog>
      )}
      {dialog.kind === "edit" && (
        <Dialog title={`Edit ${dialog.bot.name}`} onClose={close}>
          <BotForm bot={dialog.bot} onSaved={finish} onCancel={close} />
        </Dialog>
      )}
      {dialog.kind === "remove" && (
        <RemovalDialog
          subject={{
            kind: "bot",
            name: dialog.bot.name,
            preview: () => api.previewBotRemoval(dialog.bot.id),
            remove: () => api.removeBot(dialog.bot.id),
          }}
          onRemoved={finishRemoval}
          onClose={close}
        />
      )}
    </>
  );
}

interface BotTableProps {
  bots: AdminBot[];
  onEdit: (bot: AdminBot) => void;
  onRemove: (bot: AdminBot) => void;
}

function BotTable({ bots, onEdit, onRemove }: BotTableProps) {
  return (
    <TableFrame label="Bots">
      <table class="data-table">
        <caption class="visually-hidden">Bots</caption>
        <thead>
          <tr>
            <th scope="col">Bot</th>
            <th scope="col">Edit</th>
            <th scope="col">Remove</th>
            <th scope="col" class="data-table__number">
              Discord ID
            </th>
            <th scope="col" class="data-table__number">
              Owner ID
            </th>
            <th scope="col" class="data-table__number">
              Currencies
            </th>
          </tr>
        </thead>
        <tbody>
          {bots.map((bot) => (
            <tr key={bot.id}>
              <td>{bot.name}</td>
              <td>
                <EditButton subject={bot.name} onClick={() => onEdit(bot)} />
              </td>
              <td>
                <RemoveButton
                  subject={bot.name}
                  onClick={() => onRemove(bot)}
                />
              </td>
              <td class="data-table__number">{bot.discordId}</td>
              <td class="data-table__number">{bot.ownerId}</td>
              <td class="data-table__number">
                {formatQuantity(bot.currencyCount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
