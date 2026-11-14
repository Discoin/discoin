import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { CurrentUser } from "../../api/types.js";
import { useAction } from "../../lib/useAction.js";
import { ActionStatus } from "../shared/ActionStatus.jsx";
import { LoginLink } from "./LoginLink.jsx";
import { useSession } from "./SessionProvider.jsx";
import "./AccountMenu.scss";

function displayName(user: CurrentUser): string {
  return user.username ?? user.userId;
}

interface AccountPanelProps {
  id: string;
  user: CurrentUser;
  onLoggedOut: () => void;
}

function AccountPanel({ id, user, onLoggedOut }: AccountPanelProps) {
  const session = useSession();
  const action = useAction();
  const logoutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    logoutRef.current?.focus();
  }, []);

  function logOut() {
    void action.run(async () => {
      await session.logout();
      onLoggedOut();

      return "You're logged out.";
    });
  }

  return (
    <div id={id} class="account-menu__panel">
      <p class="account-menu__name">{displayName(user)}</p>
      <hr class="account-menu__separator" />
      <button
        ref={logoutRef}
        type="button"
        class="account-menu__item"
        disabled={action.state.status === "pending"}
        onClick={logOut}
      >
        Log out
      </button>
      <ActionStatus state={action.state} inlineFields={[]} />
    </div>
  );
}

function Avatar({ user }: { user: CurrentUser }) {
  const [failed, setFailed] = useState(false);

  return (
    <img
      class="account-menu__avatar"
      src={failed ? user.defaultAvatarUrl : user.avatarUrl}
      alt=""
      width="28"
      height="28"
      onError={() => setFailed(true)}
    />
  );
}

function SignedInMenu({ user }: { user: CurrentUser }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function closeIfOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeIfOutside);

    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, [open]);

  function closeOnEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;

    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={rootRef} class="account-menu" onKeyDown={closeOnEscape}>
      <button
        ref={triggerRef}
        type="button"
        class="account-menu__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Avatar user={user} />
        <span class="visually-hidden">Account: {displayName(user)}</span>
      </button>
      {open && (
        <AccountPanel
          id={panelId}
          user={user}
          onLoggedOut={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export function AccountMenu() {
  const { state } = useSession();

  if (state.status !== "ready") return null;

  if (state.data === null) {
    return (
      <div class="account-menu">
        <LoginLink variant="outline" />
      </div>
    );
  }

  return <SignedInMenu user={state.data} />;
}
