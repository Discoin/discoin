import { useState } from "preact/hooks";
import { ApiError } from "../api/errors.js";
import { toasts } from "./toasts.js";

export type ActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done" }
  | { status: "failed"; error: ApiError };

export interface Action {
  state: ActionState;
  run: (task: () => Promise<string>) => Promise<void>;
  attempt: (task: () => Promise<void>) => Promise<void>;
  fieldError: (field: string) => string | undefined;
}

export function useAction(): Action {
  const [state, setState] = useState<ActionState>({ status: "idle" });

  async function attempt(task: () => Promise<void>) {
    setState({ status: "pending" });
    try {
      await task();
      setState({ status: "done" });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;

      setState({ status: "failed", error });
    }
  }

  function run(task: () => Promise<string>) {
    return attempt(async () => toasts.show(await task()));
  }

  function fieldError(field: string): string | undefined {
    if (state.status !== "failed" || state.error.field !== field) {
      return undefined;
    }

    return state.error.message;
  }

  return { state, run, attempt, fieldError };
}
