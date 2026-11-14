import { vi } from "vitest";

import { ApiError } from "../api/errors.js";

export async function settle<T>(request: Promise<T>): Promise<T> {
  const settled = request.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await settled;
  if ("error" in outcome) throw outcome.error;

  return outcome.value;
}

export async function apiErrorOf(request: Promise<unknown>): Promise<ApiError> {
  const error = await settle(request).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ApiError)) {
    throw new Error(`Expected an ApiError, got ${String(error)}`);
  }

  return error;
}
