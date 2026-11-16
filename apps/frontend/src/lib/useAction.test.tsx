import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";

import { ApiError, ConnectionError } from "../api/errors.js";
import { ActionStatus } from "../components/shared/ActionStatus.jsx";
import {
  NO_ANSWER_MESSAGE,
  UNEXPECTED_FAILURE_MESSAGE,
  useAction,
} from "./useAction.js";

afterEach(cleanup);

const onEscaped = vi.fn();

function SaveButton({ task }: { task: () => Promise<string> }) {
  const action = useAction();
  const save = () => action.run(task);

  return (
    <>
      <button
        type="button"
        disabled={action.state.status === "pending"}
        onClick={() => void save().catch((error: unknown) => onEscaped(error))}
      >
        Save
      </button>
      <span data-testid="state">{action.state.status}</span>
      <ActionStatus state={action.state} inlineFields={[]} />
    </>
  );
}

function saveWith(task: () => Promise<string>) {
  render(<SaveButton task={task} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

async function settledState() {
  await vi.waitFor(() =>
    expect(screen.getByTestId("state").textContent).not.toBe("pending"),
  );

  return screen.getByTestId("state").textContent;
}

test("a successful task ends done", async () => {
  saveWith(() => Promise.resolve("Saved."));

  expect(await settledState()).toBe("done");
});

test("an API refusal ends failed with the API's message", async () => {
  saveWith(() => Promise.reject(new ApiError(409, "That name is taken.")));

  expect(await settledState()).toBe("failed");
  expect(screen.getByRole("status").textContent).toBe("That name is taken.");
});

test("a request that got no answer ends failed and says it may not have gone through", async () => {
  saveWith(() => Promise.reject(new ConnectionError("Failed to fetch")));

  expect(await settledState()).toBe("failed");
  expect(screen.getByRole("status").textContent).toBe(NO_ANSWER_MESSAGE);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
    "disabled",
    false,
  );
});

test("an unexpected error ends failed, says so and still escapes", async () => {
  const bug = new TypeError("Cannot read properties of undefined");
  saveWith(() => Promise.reject(bug));

  expect(await settledState()).toBe("failed");
  expect(screen.getByRole("status").textContent).toBe(
    UNEXPECTED_FAILURE_MESSAGE,
  );
  await vi.waitFor(() => expect(onEscaped).toHaveBeenCalledWith(bug));
});
