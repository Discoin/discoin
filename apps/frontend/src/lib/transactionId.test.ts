import { expect, test } from "vitest";

import { parseTransactionId } from "./transactionId.js";

const ID = "019a7c2f-91d0-7c66-8b14-f5a03e7d2c90";
const DIGITS = ID.replace(/-/g, "");

test.each([ID, ID.toUpperCase(), DIGITS, `{${ID}}`, `urn:uuid:${ID}`])(
  "accepts %s like the API does",
  (value) => {
    expect(parseTransactionId(value)).toBe(ID);
  },
);

test.each([
  "pending",
  ` ${ID}`,
  `${ID} `,
  "019a7c2f91d0-7c66-8b14-f5a03e7d2c90",
  "0123456789abcdef",
  `${ID.slice(0, -1)}g`,
  `{${DIGITS}}`,
  `urn:uuid:${DIGITS}`,
  `URN:UUID:${ID}`,
])("rejects %s like the API does", (value) => {
  expect(parseTransactionId(value)).toBeNull();
});
