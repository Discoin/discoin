import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { LocationProvider, Route, Router } from "preact-iso";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ApiError, ConnectionError } from "../../api/errors.js";
import type {
  CurrentUser,
  TransactionCause,
  TransactionDetail,
  TransactionStatus,
} from "../../api/types.js";
import {
  SessionProvider,
  useSession,
} from "../../components/session/SessionProvider.jsx";
import { TransactionPage } from "./index.jsx";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  logout: vi.fn(),
  getTransaction: vi.fn(),
}));

vi.mock("../../api/client.js", () => ({
  LOGIN_PATH: "/api/auth/discord/login",
  api,
}));

const ID = "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4";
const TRADER_ID = "530917284650193847";
const USER: CurrentUser = {
  userId: "412358906715234305",
  username: "coinkeeper",
  avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
  defaultAvatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
  isAdmin: true,
  ownedBots: [],
};

const PUBLIC: TransactionDetail = {
  id: ID,
  fromCurrencyId: "gems",
  toCurrencyId: "oats",
  fromCurrency: { abbreviation: "GEM", name: "Gems", removed: false },
  toCurrency: { abbreviation: "OAT", name: "Oats", removed: false },
  amount: 100,
  payout: 10,
  status: "Completed",
  submittedAt: "2026-11-12T22:41:09Z",
  handledAt: "2026-11-12T22:41:12Z",
};

const PRIVILEGED: TransactionDetail = { ...PUBLIC, userId: TRADER_ID };
const TRADE_TERMS = [
  "Sent",
  "Received",
  "Status",
  "Handled at",
  "Rate at the time of the trade",
];
const PUBLIC_TERMS = ["ID", "Submitted", ...TRADE_TERMS];
const PRIVILEGED_TERMS = ["ID", "Submitted", "User ID", ...TRADE_TERMS];

beforeEach(() => {
  api.getMe.mockResolvedValue(null);
  api.logout.mockResolvedValue(undefined);
  api.getTransaction.mockResolvedValue(PUBLIC);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function LogOutButton() {
  const session = useSession();

  return (
    <button type="button" onClick={() => void session.logout()}>
      Log out
    </button>
  );
}

function OtherPage() {
  return <p>Another page</p>;
}

function renderPage(id: string) {
  history.replaceState(null, "", `/transactions/${id}`);
  render(
    <LocationProvider>
      <SessionProvider>
        <LogOutButton />
        <Router>
          <Route path="/transactions/:id" component={TransactionPage} />
          <Route default component={OtherPage} />
        </Router>
      </SessionProvider>
    </LocationProvider>,
  );
}

async function openPage(id: string = ID) {
  renderPage(id);
  await waitFor(() =>
    expect(screen.queryByText("Loading transaction")).toBeNull(),
  );
}

function valueOf(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: "dt" });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`No value for ${label}`);

  return value;
}

function terms(): string[] {
  return [...document.querySelectorAll("dt")].map(
    (term) => term.textContent ?? "",
  );
}

function showing(transaction: TransactionDetail) {
  api.getTransaction.mockResolvedValue(transaction);
}

function withCause(cause: TransactionCause): TransactionDetail {
  return { ...PRIVILEGED, status: "Reversed", cause };
}

async function expectGlobalNotFound() {
  await screen.findByRole("heading", { level: 1, name: "404: Not Found" });
  await waitFor(() => expect(document.title).toBe("Page not found | Discoin"));
  expect(screen.queryByRole("definition")).toBeNull();
}

test("one heading and the title name the transaction by its short ID", async () => {
  await openPage();

  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0].textContent).toBe("Transaction a9b6d4");
  expect(document.title).toBe("Transaction a9b6d4 | Discoin");
  expect(api.getTransaction).toHaveBeenCalledWith(ID);
});

test("a public viewer sees the facts in order, with no User ID or Cause row", async () => {
  await openPage();

  expect(terms()).toEqual(PUBLIC_TERMS);
  expect(valueOf("ID").textContent).toBe(ID);
  expect(valueOf("Submitted").textContent).toBe("2026-11-12 22:41 UTC");
  expect(valueOf("Sent").textContent).toBe("100.00 GEM");
  expect(valueOf("Received").textContent).toBe("10.00 OAT");
  expect(valueOf("Handled at").textContent).toBe("2026-11-12 22:41 UTC");
  expect(valueOf("Rate at the time of the trade").textContent).toBe(
    "1 GEM = 0.1 OAT",
  );
  expect(screen.queryByText(TRADER_ID)).toBeNull();
});

test("live currencies link to their pages", async () => {
  await openPage();

  expect(
    within(valueOf("Sent"))
      .getByRole("link", { name: "GEM" })
      .getAttribute("href"),
  ).toBe("/currency/GEM");
  expect(
    within(valueOf("Received"))
      .getByRole("link", { name: "OAT" })
      .getAttribute("href"),
  ).toBe("/currency/OAT");
});

test.each(["fromCurrency", "toCurrency"] as const)(
  "a removed %s is plain text that says removed",
  async (side) => {
    showing({
      ...PUBLIC,
      [side]: { abbreviation: "OAT", name: "Oats", removed: true },
    });
    await openPage();

    const cell = valueOf(side === "fromCurrency" ? "Sent" : "Received");
    expect(cell.textContent).toMatch(/OAT \(Oats, removed\)$/);
    expect(within(cell).queryByRole("link")).toBeNull();
  },
);

test.each<TransactionStatus>([
  "Completed",
  "Refunded",
  "Cancelled",
  "Reversed",
])("a %s transaction shows its status in words", async (status) => {
  showing({ ...PUBLIC, status });
  await openPage();

  expect(valueOf("Status").textContent).toBe(status);
  expect(valueOf("Handled at").textContent).toBe("2026-11-12 22:41 UTC");
});

test("a Pending transaction says it isn't handled yet", async () => {
  showing({ ...PUBLIC, status: "Pending", handledAt: null });
  await openPage();

  expect(valueOf("Status").textContent).toBe("Pending");
  expect(valueOf("Handled at").textContent).toBe("Not handled yet");
});

test("an unknown ID shows the site's 404 page", async () => {
  api.getTransaction.mockRejectedValue(
    new ApiError(404, "No transaction with that ID."),
  );
  renderPage(ID);

  await expectGlobalNotFound();
});

test.each(["pending", "not-a-uuid"])(
  "%s is not a transaction ID, so it shows the site's 404 page without asking the API",
  async (id) => {
    api.getMe.mockResolvedValue(USER);
    renderPage(id);

    await expectGlobalNotFound();
    expect(api.getTransaction).not.toHaveBeenCalled();
  },
);

test.each([`{${ID}}`, ID.toUpperCase()])(
  "the link %s is shown and requested by its canonical ID",
  async (linked) => {
    await openPage(linked);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Transaction a9b6d4",
    );
    expect(document.title).toBe("Transaction a9b6d4 | Discoin");
    expect(api.getTransaction).toHaveBeenCalledWith(ID);
  },
);

test("an ID the API refuses as malformed shows the site's 404 page", async () => {
  api.getTransaction.mockRejectedValue(
    new ApiError(400, "transaction_id is not valid.", "transaction_id"),
  );
  renderPage(ID);

  await expectGlobalNotFound();
});

test("a 400 on another field is a load error, not a 404", async () => {
  api.getTransaction.mockRejectedValue(
    new ApiError(400, "Something else is wrong.", "other"),
  );
  await openPage();

  expect(screen.getByText("Couldn't load transaction")).toBeTruthy();
  expect(screen.queryByText("404: Not Found")).toBeNull();
});

test("a lost connection offers a retry that loads the transaction", async () => {
  api.getTransaction.mockRejectedValueOnce(
    new ConnectionError("Couldn't reach the Discoin API: offline"),
  );
  await openPage();

  expect(screen.getByText("Couldn't load transaction")).toBeTruthy();
  expect(
    screen.getByText("Couldn't reach the Discoin API: offline"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByText(ID)).toBeTruthy();
  expect(api.getTransaction).toHaveBeenCalledTimes(2);
});

test("waits for the login check before asking for the transaction", async () => {
  api.getMe.mockReturnValue(new Promise(() => undefined));
  renderPage(ID);

  expect(screen.getByText("Loading transaction")).toBeTruthy();
  expect(api.getTransaction).not.toHaveBeenCalled();
});

test("a privileged viewer sees the User ID after Submitted", async () => {
  api.getMe.mockResolvedValue(USER);
  showing(PRIVILEGED);
  await openPage();

  expect(terms()).toEqual(PRIVILEGED_TERMS);
  expect(valueOf("User ID").textContent).toBe(TRADER_ID);
});

test("logging out reloads the transaction and the private rows go away", async () => {
  api.getMe.mockResolvedValue(USER);
  api.getTransaction.mockResolvedValueOnce(
    withCause({ kind: "global", state: "active", reason: "Sold accounts." }),
  );
  await openPage();
  expect(terms()).toContain("Cause");

  fireEvent.click(screen.getByRole("button", { name: "Log out" }));

  await waitFor(() => expect(terms()).toEqual(PUBLIC_TERMS));
  expect(api.getTransaction).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(TRADER_ID)).toBeNull();
  expect(screen.queryByText(/Sold accounts/)).toBeNull();
});

test.each<[string, TransactionCause, string[]]>([
  [
    "an active bot block with its reason",
    {
      kind: "bot",
      bot: { name: "Harvest bot", removed: false },
      state: "active",
      reason: "Farmed oats.",
    },
    ["Blocked by the bot owner of Harvest bot.", "Reason: Farmed oats."],
  ],
  [
    "a removed bot without a reason",
    {
      kind: "bot",
      bot: { name: "Rock bot", removed: true },
      state: "active",
    },
    ["Blocked by the bot owner of Rock bot (removed)."],
  ],
  [
    "a lifted site wide block",
    { kind: "global", state: "lifted", reason: "Sold accounts." },
    [
      "Blocked site wide by Discoin admins.",
      "Reason: Sold accounts.",
      "This block has since been lifted.",
    ],
  ],
  [
    "a merged bot block",
    {
      kind: "bot",
      bot: { name: "Harvest bot", removed: false },
      state: "merged",
    },
    [
      "Blocked by the bot owner of Harvest bot.",
      "This block was merged into another block for the same bot.",
    ],
  ],
  [
    "no block",
    { kind: "none" },
    ["Not caused by a block. The reason isn't recorded."],
  ],
])("the cause explains %s", async (_, cause, lines) => {
  api.getMe.mockResolvedValue(USER);
  showing(withCause(cause));
  await openPage();

  const paragraphs = [...valueOf("Cause").querySelectorAll("p")].map(
    (paragraph) => paragraph.textContent,
  );
  expect(paragraphs).toEqual(lines);
  expect(terms()).toEqual([...PRIVILEGED_TERMS, "Cause"]);
});
