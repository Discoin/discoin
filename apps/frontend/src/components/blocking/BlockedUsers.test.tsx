import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";

import type { BlockListApi } from "../../api/client.js";
import type { BlockedUser } from "../../api/types.js";
import { BlockedUsers } from "./BlockedUsers.jsx";

const OWN_BLOCK: BlockedUser = {
  userId: "293847561029384756",
  reason: "Farmed oats with an alt account.",
  blockedAt: "2026-11-02T14:22:10Z",
  level: "currency",
};
const GLOBAL_BAN: BlockedUser = {
  userId: "198273645019283746",
  reason: "Sold stolen accounts for Discoin.",
  blockedAt: "2026-10-21T08:41:55Z",
  level: "global",
};

function ownerBlockList(): BlockListApi {
  return {
    level: "currency",
    list: () => Promise.resolve([OWN_BLOCK, GLOBAL_BAN]),
    block: vi.fn(),
    previewBlock: vi.fn(),
    unblock: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(cleanup);

function rowOf(userId: string): Promise<HTMLElement> {
  return screen.findByRole("row", { name: new RegExp(userId) });
}

test("an owner's own block shows its reason", async () => {
  render(<BlockedUsers blockList={ownerBlockList()} scope="from OAT" />);
  const row = within(await rowOf(OWN_BLOCK.userId));

  expect(row.getByText(OWN_BLOCK.reason)).toBeTruthy();
});

test("Unblock removes the row and returns focus to Block a user", async () => {
  const blockList = ownerBlockList();
  render(<BlockedUsers blockList={blockList} scope="from OAT" />);
  const row = await rowOf(OWN_BLOCK.userId);
  fireEvent.click(within(row).getByRole("button", { name: /^Unblock/ }));

  await waitForElementToBeRemoved(row);
  expect(blockList.unblock).toHaveBeenCalledWith(OWN_BLOCK.userId);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Block a user" }),
  );
});

test("a global ban in the owner's view is labelled and read-only", async () => {
  render(<BlockedUsers blockList={ownerBlockList()} scope="from OAT" />);
  const row = within(await rowOf(GLOBAL_BAN.userId));

  expect(row.getByText("Blocked by Discoin admins")).toBeTruthy();
  expect(row.getByText(GLOBAL_BAN.reason)).toBeTruthy();
  expect(row.queryByRole("button")).toBeNull();
});
