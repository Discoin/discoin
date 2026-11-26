import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api/client.js";
import type { StartedWebhookTest } from "../../api/types.js";
import { failureOf, isExpected } from "../../lib/useAction.js";

export const POLL_INTERVAL_MS = 2000;
export const TEST_TIMEOUT_MS = 60_000;

const SENDING = "Sending the test.";
const WAITING_FOR = {
  waiting:
    "Test event added to your event feed. Waiting for your bot to read it.",
  delivered:
    "Your bot got the test. Waiting for it to mark the test Completed or Refunded.",
};
const TIMED_OUT = {
  waiting: "Your bot didn't read its event feed within 60 seconds.",
  delivered:
    "Your bot got the test but didn't mark it Completed or Refunded within 60 seconds.",
};

type UnhandledState = keyof typeof WAITING_FOR;

export interface WebhookTestState {
  status: "idle" | "waiting" | "passed" | "failed";
  message: string;
}

export interface WebhookTest {
  state: WebhookTestState;
  run: () => Promise<void>;
}

function stateAfterStart(started: StartedWebhookTest): UnhandledState {
  return started.path === "webhook" ? "delivered" : "waiting";
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function useWebhookTest(botId: string): WebhookTest {
  const [state, setState] = useState<WebhookTestState>({
    status: "idle",
    message: "",
  });
  const isMounted = useRef(true);

  useEffect(
    () => () => {
      isMounted.current = false;
    },
    [],
  );

  function show(next: WebhookTestState) {
    if (isMounted.current) setState(next);
  }

  async function outcomeOf(
    started: StartedWebhookTest,
  ): Promise<WebhookTestState | null> {
    const deadline = Date.now() + TEST_TIMEOUT_MS;
    let lastState = stateAfterStart(started);

    while (Date.now() < deadline) {
      show({ status: "waiting", message: WAITING_FOR[lastState] });
      await pause(POLL_INTERVAL_MS);
      if (!isMounted.current) return null;

      const progress = await api.getWebhookTest(botId, started.testId);
      if (progress.state === "handled") {
        return {
          status: "passed",
          message: `Test passed. Your bot marked the test ${progress.markedStatus}.`,
        };
      }

      lastState = progress.state;
    }

    return { status: "failed", message: TIMED_OUT[lastState] };
  }

  async function run() {
    setState({ status: "waiting", message: SENDING });
    try {
      const outcome = await outcomeOf(await api.startWebhookTest(botId));
      if (outcome === null) return;

      show(outcome);
    } catch (error) {
      show({ status: "failed", message: failureOf(error).message });
      if (!isExpected(error)) throw error;
    }
  }

  return { state, run };
}
