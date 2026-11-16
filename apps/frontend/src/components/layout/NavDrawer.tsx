import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { CurrentUser } from "../../api/types.js";
import { PHONE_QUERY } from "../../lib/breakpoints.js";
import { useMediaChange } from "../../lib/useMediaChange.js";
import { Avatar, displayName } from "../session/Avatar.jsx";
import { LoginLink } from "../session/LoginLink.jsx";
import { useCurrentUser, useSession } from "../session/SessionProvider.jsx";
import { useLogout } from "../session/useLogout.js";
import { ActionStatus } from "../shared/ActionStatus.jsx";
import {
  DisclosureTrigger,
  useDisclosure,
  type Disclosure,
} from "../shared/Disclosure.jsx";
import { useModal } from "../shared/useModal.js";
import { MainNav } from "./MainNav.jsx";
import { ResourceLinks, ResourcesLabel } from "./ResourcesMenu.jsx";
import { Wordmark } from "./Wordmark.jsx";
import "../shared/Button.scss";
import "./NavDrawer.scss";

function focusCloseButton(dialog: HTMLDialogElement): void {
  const close = dialog.querySelector<HTMLButtonElement>(".nav-drawer__close");
  if (close === null) throw new Error("The menu has no close button");

  close.focus();
}

function UserIdentity({ user }: { user: CurrentUser }) {
  return (
    <p class="nav-drawer__user">
      <Avatar user={user} />
      {displayName(user)}
    </p>
  );
}

function AccountSummary({ user }: { user: CurrentUser | null }) {
  return (
    <>
      <div class="nav-drawer__account-row">
        {user === null ? (
          <LoginLink variant="outline" />
        ) : (
          <UserIdentity user={user} />
        )}
      </div>
      <hr class="nav-drawer__separator" />
    </>
  );
}

function AccountBlock() {
  const { state } = useSession();

  return (
    <div class="nav-drawer__account">
      {state.status === "ready" && <AccountSummary user={state.data} />}
    </div>
  );
}

function DrawerResources() {
  const disclosure = useDisclosure();

  return (
    <>
      <DisclosureTrigger disclosure={disclosure} class="nav-drawer__resources">
        <ResourcesLabel />
      </DisclosureTrigger>
      {disclosure.isOpen && (
        <ResourceLinks
          id={disclosure.panelId}
          class="nav-drawer__resource-links"
        />
      )}
    </>
  );
}

function DrawerLogout({ onLoggedOut }: { onLoggedOut: () => void }) {
  const logout = useLogout(onLoggedOut);

  return (
    <div class="nav-drawer__foot">
      <ActionStatus state={logout.state} inlineFields={[]} />
      <button
        type="button"
        class="button button--outline nav-drawer__logout"
        disabled={logout.state.status === "pending"}
        onClick={logout.logOut}
      >
        Log out
      </button>
    </div>
  );
}

interface DrawerDialogProps {
  disclosure: Disclosure;
}

function useFocusOnUnmount(target: RefObject<HTMLElement>): void {
  useEffect(() => () => target.current?.focus(), []);
}

function DrawerDialog({ disclosure }: DrawerDialogProps) {
  const { close, panelId, triggerRef } = disclosure;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const user = useCurrentUser();
  useModal(dialogRef, focusCloseButton);
  // After useModal, so its cleanup has closed the dialog and the menu button is no longer inert.
  useFocusOnUnmount(triggerRef);
  useMediaChange(PHONE_QUERY, (isPhone) => {
    if (!isPhone) close();
  });

  function closeOnBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function closeOnFollowedLink(event: MouseEvent) {
    if ((event.target as Element).closest("a") !== null) close();
  }

  return (
    <dialog
      ref={dialogRef}
      id={panelId}
      class="nav-drawer"
      aria-label="Menu"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={closeOnBackdrop}
    >
      <div class="nav-drawer__panel" onClick={closeOnFollowedLink}>
        <div class="nav-drawer__head">
          <a href="/" class="nav-drawer__brand">
            <Wordmark />
          </a>
          <button
            type="button"
            class="nav-drawer__close"
            aria-label="Close menu"
            onClick={close}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div class="nav-drawer__middle">
          <AccountBlock />
          <MainNav class="nav-drawer__nav">
            <DrawerResources />
          </MainNav>
        </div>
        {user !== null && <DrawerLogout onLoggedOut={close} />}
      </div>
    </dialog>
  );
}

export function NavDrawer() {
  const disclosure = useDisclosure();

  return (
    <>
      <DisclosureTrigger disclosure={disclosure} class="nav-drawer__opener">
        <span class="visually-hidden">Menu</span>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </DisclosureTrigger>
      {disclosure.isOpen && <DrawerDialog disclosure={disclosure} />}
    </>
  );
}
