import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/preact";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ApiError } from "../../api/errors.js";
import type { WebhookTestProgress } from "../../api/types.js";
import {
  createUnsavedChanges,
  UnsavedChangesContext,
} from "./unsavedChanges.js";
import { POLL_INTERVAL_MS, TEST_TIMEOUT_MS } from "./useWebhookTest.js";
import { WebhookForm } from "./WebhookForm.jsx";

const api = vi.hoisted(() => ({
  startWebhookTest: vi.fn(),
  getWebhookTest: vi.fn(),
}));

vi.mock("../../api/client.js", () => ({ api }));

const HOOK = "https://harvest.example.com/hook";
const POLLS_IN_A_TEST = TEST_TIMEOUT_MS / POLL_INTERVAL_MS;
const WAITING_FOR_THE_READ =
  "Test event added to your event feed. Waiting for your bot to read it.";
const WAITING_FOR_THE_MARK =
  "Your bot got the test. Waiting for it to mark the test Completed or Refunded.";
const WAITING_ON_FEED: WebhookTestProgress = {
  state: "waiting",
  path: "feed",
  markedStatus: null,
};
const DELIVERED_ON_FEED: WebhookTestProgress = {
  state: "delivered",
  path: "feed",
  markedStatus: null,
};
const REFUNDED_ON_WEBHOOK: WebhookTestProgress = {
  state: "handled",
  path: "webhook",
  markedStatus: "Refunded",
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

function renderForm(webhookUrl: string | null) {
  return render(
    <UnsavedChangesContext.Provider
      value={createUnsavedChanges(() => undefined)}
    >
      <WebhookForm botId="harvest" initialUrl={webhookUrl} hasSecret />
    </UnsavedChangesContext.Provider>,
  );
}

function testButton() {
  return screen.getByRole<HTMLButtonElement>("button", { name: /^Test/ });
}

async function wait(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function startTest() {
  fireEvent.click(testButton());
  await wait(0);
}

function announced(message: string) {
  return screen.getByText(message).getAttribute("role");
}

test("a webhook test waits for the mark, then names the status the bot chose", async () => {
  api.startWebhookTest.mockResolvedValue({ testId: "t1", path: "webhook" });
  api.getWebhookTest
    .mockResolvedValueOnce({ ...DELIVERED_ON_FEED, path: "webhook" })
    .mockResolvedValue(REFUNDED_ON_WEBHOOK);
  renderForm(HOOK);

  await startTest();
  const whileWaiting = [announced(WAITING_FOR_THE_MARK), testButton().disabled];
  await wait(POLL_INTERVAL_MS * 2);

  expect(whileWaiting).toEqual(["status", true]);
  expect(announced("Test passed. Your bot marked the test Refunded.")).toBe(
    "status",
  );
  expect(testButton().disabled).toBe(false);
  expect(api.getWebhookTest.mock.calls).toEqual([
    ["harvest", "t1"],
    ["harvest", "t1"],
  ]);
});

test("a feed test says when the bot read its feed", async () => {
  api.startWebhookTest.mockResolvedValue({ testId: "t1", path: "feed" });
  api.getWebhookTest.mockResolvedValue(DELIVERED_ON_FEED);
  renderForm(null);

  await startTest();
  const beforeTheRead = announced(WAITING_FOR_THE_READ);
  await wait(POLL_INTERVAL_MS);

  expect(beforeTheRead).toBe("status");
  expect(announced(WAITING_FOR_THE_MARK)).toBe("status");
});

test.each([
  {
    name: "a bot that never read its feed",
    lastProgress: WAITING_ON_FEED,
    failure: "Your bot didn't read its event feed within 60 seconds.",
  },
  {
    name: "a bot that got the test and never marked it",
    lastProgress: DELIVERED_ON_FEED,
    failure:
      "Your bot got the test but didn't mark it Completed or Refunded within 60 seconds.",
  },
])(
  "after 60 seconds, $name fails the test and polling stops",
  async ({ lastProgress, failure }) => {
    api.startWebhookTest.mockResolvedValue({ testId: "t1", path: "feed" });
    api.getWebhookTest.mockResolvedValue(lastProgress);
    renderForm(null);

    await startTest();
    await wait(TEST_TIMEOUT_MS - 1);
    const beforeTheTimeout = screen.queryByText(failure);
    await wait(1);
    await wait(TEST_TIMEOUT_MS);

    expect(beforeTheTimeout).toBeNull();
    expect(announced(failure)).toBe("status");
    expect(testButton().disabled).toBe(false);
    expect(api.getWebhookTest).toHaveBeenCalledTimes(POLLS_IN_A_TEST);
  },
);

test("a webhook that fails shows the reason right away and never polls", async () => {
  const reason = "Your webhook answered 500. Discoin expects a 2xx answer.";
  api.startWebhookTest.mockRejectedValue(new ApiError(502, reason));
  renderForm(HOOK);

  await startTest();
  await wait(TEST_TIMEOUT_MS);

  expect(announced(reason)).toBe("status");
  expect(api.getWebhookTest).not.toHaveBeenCalled();
});

test("a failed poll shows its error and stops", async () => {
  const reason = "No webhook test with that ID.";
  api.startWebhookTest.mockResolvedValue({ testId: "t1", path: "feed" });
  api.getWebhookTest.mockRejectedValue(new ApiError(404, reason));
  renderForm(null);

  await startTest();
  await wait(TEST_TIMEOUT_MS);

  expect(announced(reason)).toBe("status");
  expect(api.getWebhookTest).toHaveBeenCalledTimes(1);
});

test("leaving the page stops the polling", async () => {
  api.startWebhookTest.mockResolvedValue({ testId: "t1", path: "feed" });
  api.getWebhookTest.mockResolvedValue(WAITING_ON_FEED);
  const { unmount } = renderForm(null);

  await startTest();
  await wait(POLL_INTERVAL_MS);
  unmount();
  await wait(TEST_TIMEOUT_MS);

  expect(api.getWebhookTest).toHaveBeenCalledTimes(1);
});
