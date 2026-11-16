import { useEffect, useRef } from "preact/hooks";
import type { CurrentUser } from "../../api/types.js";
import { ActionStatus } from "../shared/ActionStatus.jsx";
import {
  DisclosureTrigger,
  useDisclosure,
  usePopupDismissal,
} from "../shared/Disclosure.jsx";
import { Avatar, displayName } from "./Avatar.jsx";
import { LoginLink } from "./LoginLink.jsx";
import { useSession } from "./SessionProvider.jsx";
import { useLogout } from "./useLogout.js";
import "./AccountMenu.scss";

interface AccountPanelProps {
  id: string;
  user: CurrentUser;
  onLoggedOut: () => void;
}

function AccountPanel({ id, user, onLoggedOut }: AccountPanelProps) {
  const logout = useLogout(onLoggedOut);
  const logoutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    logoutRef.current?.focus();
  }, []);

  return (
    <div id={id} class="account-menu__panel">
      <p class="account-menu__name">{displayName(user)}</p>
      <hr class="account-menu__separator" />
      <button
        ref={logoutRef}
        type="button"
        class="account-menu__item"
        disabled={logout.state.status === "pending"}
        onClick={logout.logOut}
      >
        Log out
      </button>
      <ActionStatus state={logout.state} inlineFields={[]} />
    </div>
  );
}

function SignedInMenu({ user }: { user: CurrentUser }) {
  const disclosure = useDisclosure();
  const popup = usePopupDismissal(disclosure);

  return (
    <div
      ref={popup.rootRef}
      class="account-menu"
      onKeyDown={popup.closeOnEscape}
    >
      <DisclosureTrigger disclosure={disclosure} class="account-menu__trigger">
        <Avatar user={user} />
        <span class="visually-hidden">Account: {displayName(user)}</span>
      </DisclosureTrigger>
      {disclosure.isOpen && (
        <AccountPanel
          id={disclosure.panelId}
          user={user}
          onLoggedOut={disclosure.close}
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
