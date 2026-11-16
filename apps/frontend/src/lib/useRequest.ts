import { useCallback, useEffect, useState } from "preact/hooks";

export type RequestState<T> =
  | { status: "loading" }
  | { status: "failed"; error: Error }
  | { status: "ready"; data: T };

export interface Request<T> {
  state: RequestState<T>;
  reload: () => void;
  update: (data: T) => void;
  change: (apply: (data: T) => T) => void;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function useRequest<T>(
  load: () => Promise<T>,
  inputs: unknown[],
): Request<T> {
  const [state, setState] = useState<RequestState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    load().then(
      (data) => current && setState({ status: "ready", data }),
      (reason: unknown) =>
        current && setState({ status: "failed", error: asError(reason) }),
    );

    return () => {
      current = false;
    };
  }, [...inputs, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const update = useCallback(
    (data: T) => setState({ status: "ready", data }),
    [],
  );
  const change = useCallback(
    (apply: (data: T) => T) =>
      setState((current) => {
        if (current.status !== "ready") {
          throw new Error("Changed data that hasn't loaded");
        }

        return { status: "ready", data: apply(current.data) };
      }),
    [],
  );

  return { state, reload, update, change };
}
