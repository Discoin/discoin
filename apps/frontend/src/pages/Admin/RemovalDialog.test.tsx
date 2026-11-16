import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

import type { RemovalPreview } from "../../api/types.js";
import { RemovalDialog, type RemovalSubject } from "./RemovalDialog.jsx";

const PREVIEW: RemovalPreview = {
  currencies: [
    { id: "oats", abbreviation: "OAT", name: "Oats" },
    { id: "pebbles", abbreviation: "PBL", name: "Pebbles" },
  ],
  pendingTransactions: 3,
  enforcedBlocks: 2,
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

function subject(kind: RemovalSubject["kind"], preview = PREVIEW) {
  return {
    kind,
    name: "Oat bot",
    preview: () => Promise.resolve(preview),
    remove: vi.fn(() => Promise.resolve()),
  };
}

function open(
  removed: RemovalSubject,
  onRemoved = vi.fn(() => Promise.resolve()),
) {
  render(
    <RemovalDialog subject={removed} onRemoved={onRemoved} onClose={vi.fn()} />,
  );
}

test("a bot removal lists its currencies, the counts and what stops working", async () => {
  open(subject("bot"));

  expect(await screen.findByText("OAT (Oats)")).toBeTruthy();
  expect(screen.getByText("PBL (Pebbles)")).toBeTruthy();
  expect(screen.getByText(/3 transactions still Pending/)).toBeTruthy();
  expect(screen.getByText("2 blocks will stop being enforced.")).toBeTruthy();
  expect(screen.getByText(/API token and webhook stop working/)).toBeTruthy();
  expect(screen.getByText(/shows as removed/)).toBeTruthy();
  expect(screen.getByText("This can't be undone")).toBeTruthy();
});

test("a currency removal with no blocks of its own leaves out the block line", async () => {
  open(subject("currency", { ...PREVIEW, enforcedBlocks: 0 }));

  await screen.findByText("OAT (Oats)");
  expect(screen.queryByText(/stop being enforced/)).toBeNull();
  expect(screen.queryByText(/API token/)).toBeNull();
  expect(screen.getByRole("button", { name: "Remove currency" })).toBeTruthy();
});

test("cancel comes first so focus starts on the safe choice", () => {
  open(subject("bot"));

  const buttons = screen
    .getAllByRole("button")
    .filter((button) => !button.classList.contains("dialog__close"));
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Cancel",
    "Remove bot",
  ]);
  expect(document.activeElement?.textContent).toBe("Cancel");
});

test("confirming removes and then reports back", async () => {
  const removed = subject("bot");
  const onRemoved = vi.fn(() => Promise.resolve());
  open(removed, onRemoved);
  const confirm = await screen.findByRole("button", { name: "Remove bot" });
  await vi.waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));

  fireEvent.click(confirm);

  await vi.waitFor(() => expect(onRemoved).toHaveBeenCalled());
  expect(removed.remove).toHaveBeenCalledOnce();
});
