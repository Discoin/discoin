import { useState } from "preact/hooks";
import { ApiError, ConnectionError } from "../api/errors.js";
import { toasts } from "./toasts.js";

export const NO_ANSWER_MESSAGE =
  "Your request didn't reach Discoin or no answer came back, so it may not have gone through. Check your connection and try again.";
export const UNEXPECTED_FAILURE_MESSAGE =
  "Something went wrong on this page, so it may not have gone through. Reload the page and try again.";

export interface ActionFailure {
  message: string;
  field?: string;
}

export type ActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done" }
  | { status: "failed"; error: ActionFailure };

export interface Action {
  state: ActionState;
  run: (task: () => Promise<string>) => Promise<void>;
  attempt: (task: () => Promise<void>) => Promise<void>;
  fieldError: (field: string) => string | undefined;
}

function failureOf(error: unknown): ActionFailure {
  if (error instanceof ApiError) return error;
  if (error instanceof ConnectionError) return { message: NO_ANSWER_MESSAGE };

  return { message: UNEXPECTED_FAILURE_MESSAGE };
}

function isExpected(error: unknown): boolean {
  return error instanceof ApiError || error instanceof ConnectionError;
}

export function useAction(): Action {
  const [state, setState] = useState<ActionState>({ status: "idle" });

  async function attempt(task: () => Promise<void>) {
    setState({ status: "pending" });
    try {
      await task();
      setState({ status: "done" });
    } catch (error) {
      setState({ status: "failed", error: failureOf(error) });
      if (!isExpected(error)) throw error;
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
