import { sampleCurrentUser } from "./data.js";

export const MOCK_VIEWER_KEY = "discoin-mock-viewer";

export function mockViewerId(): string {
  const chosen =
    typeof sessionStorage === "undefined"
      ? null
      : sessionStorage.getItem(MOCK_VIEWER_KEY);

  return chosen ?? sampleCurrentUser.userId;
}
