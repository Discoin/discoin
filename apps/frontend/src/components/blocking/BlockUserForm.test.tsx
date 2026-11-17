import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { LocationProvider, Route, Router } from "preact-iso";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

import type { BlockListApi } from "../../api/client.js";
import type { Transaction } from "../../api/types.js";
import { focusMainWhenFocusIsLost } from "../../lib/focus.js";
import { toasts } from "../../lib/toasts.js";
import { Dialog } from "../shared/Dialog.jsx";
import { BlockUserForm } from "./BlockUserForm.jsx";

const REVERSIBLE: Transaction = {
  id: "019a7c2f-91d0-7c66-8b14-f5a03e7d2c90",
  fromCurrencyId: "pebbles",
  toCurrencyId: "oats",
  fromCurrency: { abbreviation: "PBL", name: "Pebbles", removed: false },
  toCurrency: { abbreviation: "OAT", name: "Oats", removed: false },
  amount: 100,
  payout: 10,
  status: "Completed",
  submittedAt: "2026-11-12T21:58:44Z",
  handledAt: "2026-11-12T21:58:51Z",
};
const TRANSACTION_LINK = `Transaction ${REVERSIBLE.id}`;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ownerBlockListWithPreview(block: BlockListApi["block"]): BlockListApi {
  return {
    level: "bot",
    list: vi.fn(),
    block: vi.fn(block),
    previewBlock: vi.fn(() => Promise.resolve([REVERSIBLE])),
    unblock: vi.fn(),
  };
}

function TransactionStub() {
  return <h1>Transaction page</h1>;
}

function renderReviewInDialog(blockList: BlockListApi) {
  function OwnerStub() {
    return (
      <Dialog title="Block a user" onClose={vi.fn()}>
        <BlockUserForm
          blockList={blockList}
          scope="from Harvest bot"
          onBlocked={vi.fn()}
          onCancel={vi.fn()}
        />
      </Dialog>
    );
  }

  history.replaceState(null, "", "/owner");
  render(
    <LocationProvider>
      <main id="main" tabIndex={-1}>
        <Router onRouteChange={focusMainWhenFocusIsLost}>
          <Route path="/owner" component={OwnerStub} />
          <Route path="/transactions/:id" component={TransactionStub} />
        </Router>
      </main>
    </LocationProvider>,
  );
}

async function reviewReversal() {
  fireEvent.input(screen.getByLabelText("Discord user ID"), {
    target: { value: "530917284650193847" },
  });
  fireEvent.input(screen.getByLabelText("Reason"), {
    target: { value: "Laundered coins." },
  });
  fireEvent.click(
    screen.getByLabelText("Also reverse their completed transactions"),
  );
  fireEvent.click(screen.getByLabelText("Both"));
  fireEvent.click(screen.getByRole("button", { name: "Review reversal" }));
  await screen.findByRole("link", { name: TRANSACTION_LINK });
}

function ownerBlockListThatNeverAnswers(): BlockListApi {
  const unanswered = () => new Promise<never>(() => undefined);

  return {
    level: "bot",
    list: vi.fn(),
    block: vi.fn(unanswered),
    previewBlock: vi.fn(unanswered),
    unblock: vi.fn(),
  };
}

test("every field and choice is locked while the review is loading", async () => {
  render(
    <BlockUserForm
      blockList={ownerBlockListThatNeverAnswers()}
      scope="from Harvest bot"
      onBlocked={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByLabelText("Also reverse their completed transactions"),
  );
  fireEvent.click(screen.getByLabelText("Both"));
  fireEvent.click(screen.getByRole("button", { name: "Review reversal" }));

  const locked = [
    screen.getByLabelText("Discord user ID"),
    screen.getByLabelText("Reason"),
    screen.getByLabelText("Also reverse their completed transactions"),
    screen.getByLabelText("All time"),
    screen.getByLabelText("Both"),
    screen.getByRole("button", { name: "Review reversal" }),
  ];

  for (const control of locked) {
    await vi.waitFor(() => expect(control.matches(":disabled")).toBe(true));
  }
});

test("following a transaction link leaves the review without blocking or toasting", async () => {
  const blockList = ownerBlockListWithPreview(() =>
    Promise.reject(new Error("The block must not be sent")),
  );
  const shownToast = vi.spyOn(toasts, "show");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  renderReviewInDialog(blockList);
  await reviewReversal();

  fireEvent.click(screen.getByRole("link", { name: TRANSACTION_LINK }));

  expect(
    await screen.findByRole("heading", { name: "Transaction page" }),
  ).toBeTruthy();
  expect(location.pathname).toBe(`/transactions/${REVERSIBLE.id}`);
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(document.getElementById("main"));
  expect(blockList.block).not.toHaveBeenCalled();
  expect(shownToast).not.toHaveBeenCalled();
});

test("the transaction links can't be followed while the block is being sent", async () => {
  const blockList = ownerBlockListWithPreview(
    () => new Promise<never>(() => undefined),
  );
  renderReviewInDialog(blockList);
  await reviewReversal();
  const transactions = screen
    .getByRole("link", { name: TRANSACTION_LINK })
    .closest(".reversal-review__transactions");
  expect(transactions?.hasAttribute("inert")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: /^Block and reverse/ }));

  await vi.waitFor(() =>
    expect(transactions?.hasAttribute("inert")).toBe(true),
  );
  expect(blockList.block).toHaveBeenCalledTimes(1);
});
