import { ApiError } from "../../api/errors.js";

const BAD_REQUEST = 400;
const INACTIVE_CURRENCY_FIELD = "currencyId";

function isInactiveRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === BAD_REQUEST &&
    error.field === INACTIVE_CURRENCY_FIELD
  );
}

export async function noticingDeactivation<T>(
  save: Promise<T>,
  onDeactivated: () => void,
): Promise<T> {
  try {
    return await save;
  } catch (error) {
    if (isInactiveRefusal(error)) onDeactivated();
    throw error;
  }
}
