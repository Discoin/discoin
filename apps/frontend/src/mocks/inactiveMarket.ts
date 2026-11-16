import { sessionSettingIsOn } from "./sessionSetting.js";

export const INACTIVE_MARKET_KEY = "discoin-mock-inactive-market";

export function marketStartsInactive(): boolean {
  return sessionSettingIsOn(INACTIVE_MARKET_KEY);
}
