export const INACTIVE_MARKET_KEY = "discoin-mock-inactive-market";

export function marketStartsInactive(): boolean {
  return (
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem(INACTIVE_MARKET_KEY) !== null
  );
}
