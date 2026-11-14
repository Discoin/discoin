import { useRef, useState } from "preact/hooks";
import type { BlockListApi } from "../../api/client.js";
import type { BlockedUser } from "../../api/types.js";
import { formatTimestamp } from "../../lib/format.js";
import { useAction } from "../../lib/useAction.js";
import { useRequest } from "../../lib/useRequest.js";
import { ActionStatus } from "../shared/ActionStatus.jsx";
import { BlockUserForm } from "./BlockUserForm.jsx";
import { Button } from "../shared/Button.jsx";
import { Dialog } from "../shared/Dialog.jsx";
import { EmptyState } from "../shared/EmptyState.jsx";
import { Loadable } from "../shared/Loadable.jsx";
import { TableFrame } from "../shared/TableFrame.jsx";
import "./BlockedUsers.scss";
import "../shared/DataTable.scss";
import "../layout/Panel.scss";

interface BlockedUsersProps {
  blockList: BlockListApi;
  scope: string;
}

export function BlockedUsers({ blockList, scope }: BlockedUsersProps) {
  const request = useRequest(() => blockList.list(), [blockList]);

  return (
    <Loadable
      state={request.state}
      label="blocked users"
      onRetry={request.reload}
    >
      {(users) => (
        <BlockedUsersEditor
          blockList={blockList}
          scope={scope}
          users={users}
          onChange={request.update}
        />
      )}
    </Loadable>
  );
}

interface BlockedUsersEditorProps extends BlockedUsersProps {
  users: BlockedUser[];
  onChange: (users: BlockedUser[]) => void;
}

function BlockedUsersEditor({
  blockList,
  scope,
  users,
  onChange,
}: BlockedUsersEditorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const action = useAction();
  const openerRef = useRef<HTMLButtonElement>(null);
  const pending = action.state.status === "pending";
  const closeDialog = () => setDialogOpen(false);

  function finishBlock(blocked: BlockedUser) {
    onChange([blocked, ...users]);
    closeDialog();
  }

  function focusOpener() {
    const opener = openerRef.current;
    if (opener === null) throw new Error("The block button didn't render");

    opener.focus();
  }

  function unblock(unblocked: BlockedUser) {
    void action.run(async () => {
      await blockList.unblock(unblocked.userId);
      onChange(users.filter((user) => user !== unblocked));
      focusOpener();

      return `Unblocked ${unblocked.userId} ${scope}.`;
    });
  }

  return (
    <div class="stack-tight">
      <div class="blocked-users__toolbar">
        <Button
          ref={openerRef}
          variant="danger"
          onClick={() => setDialogOpen(true)}
        >
          Block a user
        </Button>
        <ActionStatus state={action.state} inlineFields={[]} />
      </div>
      {dialogOpen && (
        <Dialog title={`Block a user ${scope}`} onClose={closeDialog}>
          <BlockUserForm
            blockList={blockList}
            scope={scope}
            onBlocked={finishBlock}
            onCancel={closeDialog}
          />
        </Dialog>
      )}
      {users.length === 0 ? (
        <EmptyState title="Nobody is blocked">
          <p>Users you block show up here.</p>
        </EmptyState>
      ) : (
        <TableFrame label="Blocked users">
          <table class="data-table">
            <caption class="visually-hidden">Blocked users</caption>
            <thead>
              <tr>
                <th scope="col">Discord user ID</th>
                <th scope="col">Reason</th>
                <th scope="col">Blocked</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={`${user.level}-${user.userId}`}>
                  <td class="data-table__number">{user.userId}</td>
                  <td class="blocked-users__reason">{user.reason}</td>
                  <td class="data-table__number">
                    {formatTimestamp(user.blockedAt)}
                  </td>
                  <td>
                    {user.level === blockList.level ? (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => unblock(user)}
                      >
                        Unblock
                        <span class="visually-hidden"> {user.userId}</span>
                      </Button>
                    ) : (
                      <span class="blocked-users__badge">
                        Blocked by Discoin admins
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
