import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";

import { Loadable } from "./Loadable.jsx";

const EMPTY = {
  when: (list: string[]) => list.length === 0,
  title: "Nothing here",
  body: <p>Add something first.</p>,
};

function showList(data: string[]) {
  return <p>{data.join(", ")}</p>;
}

test("says what is loading while the request runs", () => {
  render(
    <Loadable
      state={{ status: "loading" }}
      label="currencies"
      onRetry={vi.fn()}
    >
      {showList}
    </Loadable>,
  );

  expect(screen.getByRole("status").textContent).toBe("Loading currencies");
});

test("shows the error and retries on request", () => {
  const retry = vi.fn();
  render(
    <Loadable
      state={{ status: "failed", error: new Error("Server down.") }}
      label="currencies"
      onRetry={retry}
    >
      {showList}
    </Loadable>,
  );

  expect(screen.getByRole("alert").textContent).toContain("Server down.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});

test("shows the empty state when the data is empty", () => {
  render(
    <Loadable
      state={{ status: "ready", data: [] }}
      label="currencies"
      onRetry={vi.fn()}
      empty={EMPTY}
    >
      {showList}
    </Loadable>,
  );

  expect(screen.getByText("Nothing here")).toBeTruthy();
});

test("renders the data once it is ready", () => {
  render(
    <Loadable
      state={{ status: "ready", data: ["OAT", "PBL"] }}
      label="currencies"
      onRetry={vi.fn()}
      empty={EMPTY}
    >
      {showList}
    </Loadable>,
  );

  expect(screen.getByText("OAT, PBL")).toBeTruthy();
});
