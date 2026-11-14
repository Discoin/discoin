import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";

import type { BlockListApi } from "../../api/client.js";
import { BlockUserForm } from "./BlockUserForm.jsx";

afterEach(cleanup);

function ownerBlockListThatNeverAnswers(): BlockListApi {
  const unanswered = () => new Promise<never>(() => undefined);

  return {
    level: "currency",
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
      scope="from OAT"
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
