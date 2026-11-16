import { useAction, type ActionState } from "../../lib/useAction.js";
import { useSession } from "./SessionProvider.jsx";

export interface Logout {
  state: ActionState;
  logOut: () => void;
}

export function useLogout(onLoggedOut: () => void): Logout {
  const session = useSession();
  const action = useAction();

  function logOut() {
    void action.run(async () => {
      await session.logout();
      onLoggedOut();

      return "You're logged out.";
    });
  }

  return { state: action.state, logOut };
}
