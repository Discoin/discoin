import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";

import { Loadable } from "../components/shared/Loadable.jsx";
import { useRequest } from "./useRequest.js";

function Prices({ load }: { load: () => Promise<string> }) {
  const request = useRequest(load, []);

  return (
    <Loadable state={request.state} label="prices" onRetry={request.reload}>
      {(data) => <p>{data}</p>}
    </Loadable>
  );
}

test("a failed request shows its error and loads again on retry", async () => {
  const load = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error("Server down."))
    .mockResolvedValueOnce("OAT 0.1000");
  render(<Prices load={load} />);

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Server down.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByText("OAT 0.1000")).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(2);
});
