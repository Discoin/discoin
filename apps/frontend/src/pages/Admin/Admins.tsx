import { useRef, useState } from "preact/hooks";
import { TableFrame } from "../../components/shared/TableFrame.jsx";
import { api } from "../../api/client.js";
import type { AdminUser } from "../../api/types.js";
import { ActionStatus } from "../../components/shared/ActionStatus.jsx";
import { Button } from "../../components/shared/Button.jsx";
import { ConfirmButton } from "../../components/shared/ConfirmButton.jsx";
import { Field } from "../../components/shared/Field.jsx";
import { Loadable } from "../../components/shared/Loadable.jsx";
import { focusFirstInput } from "../../lib/focus.js";
import { useAction } from "../../lib/useAction.js";
import { useRequest } from "../../lib/useRequest.js";
import "../../components/shared/DataTable.scss";

export function Admins() {
  const request = useRequest(() => api.listAdmins(), []);

  return (
    <Loadable state={request.state} label="admins" onRetry={request.reload}>
      {(admins) => <AdminsEditor admins={admins} onChange={request.update} />}
    </Loadable>
  );
}

interface AdminsEditorProps {
  admins: AdminUser[];
  onChange: (admins: AdminUser[]) => void;
}

function nameOf(admin: AdminUser): string {
  return admin.username ?? admin.userId;
}

function AdminsEditor({ admins, onChange }: AdminsEditorProps) {
  const [userId, setUserId] = useState("");
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);

  function grant(event: Event) {
    event.preventDefault();
    void action.run(async () => {
      const admin = await api.grantAdmin(userId);
      onChange([...admins, admin]);
      setUserId("");

      return `${nameOf(admin)} is now an admin.`;
    });
  }

  function remove(admin: AdminUser) {
    void action.run(async () => {
      await api.removeAdmin(admin.userId);
      onChange(admins.filter((candidate) => candidate.userId !== admin.userId));
      focusFirstInput(formRef.current);

      return `${nameOf(admin)} is no longer an admin.`;
    });
  }

  return (
    <div class="stack-tight">
      <TableFrame label="Admins">
        <table class="data-table">
          <caption class="visually-hidden">Admins</caption>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Discord user ID</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => (
              <tr key={admin.userId}>
                <td>{nameOf(admin)}</td>
                <td class="data-table__number">{admin.userId}</td>
                <td>
                  <ConfirmButton
                    label={
                      <>
                        Remove
                        <span class="visually-hidden"> {nameOf(admin)}</span>
                      </>
                    }
                    variant="outline"
                    disabled={action.state.status === "pending"}
                    warning={`${nameOf(admin)} loses access to this page right away.`}
                    confirmLabel="Remove admin"
                    cancelLabel="Keep admin"
                    onConfirm={() => remove(admin)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <form ref={formRef} class="form-row" onSubmit={grant}>
        <Field
          label="Discord user ID"
          inputMode="numeric"
          autoComplete="off"
          value={userId}
          error={action.fieldError("userId")}
          onInput={(event) => setUserId(event.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={action.state.status === "pending"}
        >
          Make admin
        </Button>
      </form>
      <ActionStatus state={action.state} inlineFields={["userId"]} />
    </div>
  );
}
