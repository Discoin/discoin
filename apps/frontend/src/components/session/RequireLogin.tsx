import type { ComponentChildren } from "preact";
import type { CurrentUser } from "../../api/types.js";
import { EmptyState } from "../shared/EmptyState.jsx";
import { Loadable } from "../shared/Loadable.jsx";
import { LoginLink } from "./LoginLink.jsx";
import { useSession } from "./SessionProvider.jsx";

export type Access = "user" | "admin";

interface RequireLoginProps {
  access: Access;
  children: (user: CurrentUser) => ComponentChildren;
}

export function RequireLogin({ access, children }: RequireLoginProps) {
  const session = useSession();

  return (
    <Loadable state={session.state} label="your login" onRetry={session.reload}>
      {(user) => {
        if (user === null) {
          return (
            <EmptyState title="Log in to see this page">
              <p>This page shows your own Discoin data.</p>
              <LoginLink variant="primary" />
            </EmptyState>
          );
        }

        if (access === "admin" && !user.isAdmin) {
          return (
            <EmptyState title="Only Discoin admins can open this page">
              <p>Ask an admin if you need access.</p>
            </EmptyState>
          );
        }

        return children(user);
      }}
    </Loadable>
  );
}
