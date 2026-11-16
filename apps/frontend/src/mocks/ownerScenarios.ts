import { ConnectionError } from "../api/errors.js";
import { sessionSettingIsOn } from "./sessionSetting.js";

export const DEACTIVATED_ON_RENAME_KEY = "discoin-mock-deactivated-on-rename";
export const STALLED_RENAMES_KEY = "discoin-mock-stalled-renames";
export const LOST_CONNECTION_ON_RENAME_KEY =
  "discoin-mock-lost-connection-on-rename";

export function renameFindsCurrencyDeactivated(): boolean {
  return sessionSettingIsOn(DEACTIVATED_ON_RENAME_KEY);
}

export function renamesStall(): boolean {
  return sessionSettingIsOn(STALLED_RENAMES_KEY);
}

export function renamesLoseConnection(): boolean {
  return sessionSettingIsOn(LOST_CONNECTION_ON_RENAME_KEY);
}

export function lostConnection(): ConnectionError {
  return new ConnectionError(
    "Couldn't reach the Discoin API: the mock dropped the connection.",
  );
}
