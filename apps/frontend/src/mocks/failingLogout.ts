import { ApiError } from "../api/errors.js";
import { sessionSettingIsOn } from "./sessionSetting.js";

export const FAILING_LOGOUT_KEY = "discoin-mock-failing-logout";
export const FAILED_LOGOUT_MESSAGE = "Logging out didn't work. Try again.";

const SERVER_ERROR = 500;

export function logoutFails(): boolean {
  return sessionSettingIsOn(FAILING_LOGOUT_KEY);
}

export function failedLogout(): ApiError {
  return new ApiError(SERVER_ERROR, FAILED_LOGOUT_MESSAGE);
}
