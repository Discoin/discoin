import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";

import { ApiError } from "../../api/errors.js";
import type { AdminBot } from "../../api/types.js";
import { BotForm } from "./BotForm.jsx";

const { addBot, updateBot } = vi.hoisted(() => ({
  addBot: vi.fn(),
  updateBot: vi.fn(),
}));

vi.mock("../../api/client.js", () => ({ api: { addBot, updateBot } }));

const BOT: AdminBot = {
  id: "oat-bot",
  name: "Oat bot",
  discordId: "990000000000000001",
  ownerId: "412358906715234305",
  currencyCount: 1,
};

afterEach(() => {
  cleanup();
  addBot.mockReset();
  updateBot.mockReset();
});

function type(label: string, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

test("a new bot sends its name, Discord ID and owner", async () => {
  addBot.mockReturnValue(new Promise(() => undefined));
  render(<BotForm bot={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
  type("Bot name", "Gem bot");
  type("Bot's Discord ID", "990000000000000002");
  type("Owner ID", "412358906715234305");
  fireEvent.click(screen.getByRole("button", { name: "Add bot" }));

  await vi.waitFor(() =>
    expect(addBot).toHaveBeenCalledWith({
      name: "Gem bot",
      discordId: "990000000000000002",
      ownerId: "412358906715234305",
    }),
  );
});

test("editing says a new owner clears the token and webhook", () => {
  render(<BotForm bot={BOT} onSaved={vi.fn()} onCancel={vi.fn()} />);

  expect(
    screen.getByText(
      /clears the bot's API token, webhook URL and webhook secret/,
    ),
  ).toBeTruthy();
});

test("editing sends only what changed", async () => {
  updateBot.mockReturnValue(new Promise(() => undefined));
  render(<BotForm bot={BOT} onSaved={vi.fn()} onCancel={vi.fn()} />);
  type("Owner ID", "305918264730192845");
  fireEvent.click(screen.getByRole("button", { name: "Save bot" }));

  await vi.waitFor(() =>
    expect(updateBot).toHaveBeenCalledWith("oat-bot", {
      ownerId: "305918264730192845",
    }),
  );
});

test("a taken Discord ID shows on its field", async () => {
  addBot.mockRejectedValue(
    new ApiError(409, "Another bot already has that Discord ID.", "discordId"),
  );
  render(<BotForm bot={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add bot" }));

  const field = screen.getByLabelText("Bot's Discord ID");
  await vi.waitFor(() =>
    expect(field.getAttribute("aria-invalid")).toBe("true"),
  );
});
