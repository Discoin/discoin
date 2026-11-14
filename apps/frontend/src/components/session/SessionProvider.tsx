import { createContext, type ComponentChildren } from "preact";
import { useContext, useMemo } from "preact/hooks";
import { api } from "../../api/client.js";
import type { CurrentUser } from "../../api/types.js";
import { useRequest, type RequestState } from "../../lib/useRequest.js";

export interface Session {
  state: RequestState<CurrentUser | null>;
  reload: () => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ComponentChildren }) {
  const request = useRequest(() => api.getMe(), []);
  const { state, reload, update } = request;
  const session = useMemo<Session>(
    () => ({
      state,
      reload,
      logout: async () => {
        await api.logout();
        update(null);
      },
    }),
    [state, reload, update],
  );

  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error("useSession needs a SessionProvider above it");
  }

  return session;
}

export function useCurrentUser(): CurrentUser | null {
  const { state } = useSession();

  return state.status === "ready" ? state.data : null;
}
