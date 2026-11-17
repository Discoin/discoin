import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError, ConnectionError, DailyCapError } from "./errors.js";
import { createHttpApi } from "./http.js";

const api = createHttpApi();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

  return { url, init };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requests", () => {
  test("reads go to /api with the session cookie", async () => {
    const fetchMock = stubFetch(jsonResponse(200, []));

    await api.listCurrencies();

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/currencies");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBeUndefined();
  });

  test("path segments are encoded", async () => {
    const fetchMock = stubFetch(jsonResponse(200, {}));

    await api.getCurrency("a/b");

    expect(lastCall(fetchMock).url).toBe("/api/currencies/a%2Fb");
  });

  test("a transaction is read by its encoded ID with the session cookie", async () => {
    const fetchMock = stubFetch(jsonResponse(200, {}));

    await api.getTransaction("a/b");

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/transactions/a%2Fb");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
  });

  test("history asks for the window in days", async () => {
    const fetchMock = stubFetch(jsonResponse(200, []));

    await api.getReserveHistory("c1", 7);

    expect(lastCall(fetchMock).url).toBe("/api/currencies/c1/history?days=7");
  });

  test("writes send JSON bodies with the API's field names", async () => {
    const fetchMock = stubFetch(noContent());

    await api.setWebhookUrl("b1", "https://bot.example.com/hook");

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/bots/b1/webhook-url");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      webhookUrl: "https://bot.example.com/hook",
    });
  });

  test("a block without a reversal leaves reverse out", async () => {
    const fetchMock = stubFetch(jsonResponse(201, {}));

    await api.globalBlocks.block("530917284650193847", "Spam");

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/admin/blocks");
    expect(JSON.parse(init.body as string)).toEqual({
      userId: "530917284650193847",
      reason: "Spam",
    });
  });

  test("the quote sends both currencies and the amount", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { payout: 99.9 }));

    const payout = await api.getQuote("a", "b", 1000);

    expect(payout).toBe(99.9);
    expect(lastCall(fetchMock).url).toBe(
      "/api/quote?fromCurrencyId=a&toCurrencyId=b&amount=1000",
    );
  });

  test("a regenerated token comes back as plain text", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { token: "dsc_live_abc" }));

    expect(await api.regenerateApiToken("b1")).toBe("dsc_live_abc");
    expect(lastCall(fetchMock).url).toBe("/api/bots/b1/api-token");
  });

  test("a webhook secret is generated for the bot", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { secret: "whsec_abc" }));

    expect(await api.generateWebhookSecret("b1")).toBe("whsec_abc");
    expect(lastCall(fetchMock).url).toBe("/api/bots/b1/webhook-secret");
  });

  test("removing the webhook deletes the bot's URL", async () => {
    const fetchMock = stubFetch(noContent());

    await api.removeWebhookUrl("b1");

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/bots/b1/webhook-url");
    expect(init.method).toBe("DELETE");
  });

  test("the owner's pending list is the bot's", async () => {
    const fetchMock = stubFetch(jsonResponse(200, []));

    await api.listPendingTransactions("b1");

    expect(lastCall(fetchMock).url).toBe("/api/bots/b1/transactions/pending");
  });

  test("owner blocks live under the bot", async () => {
    const fetchMock = stubFetch(noContent());
    const blocks = api.botBlocks("b1");

    await blocks.unblock("530917284650193847");

    expect(blocks.level).toBe("bot");
    expect(lastCall(fetchMock).url).toBe(
      "/api/bots/b1/blocks/530917284650193847",
    );
  });

  test("a command that answers with content is refused", async () => {
    stubFetch(jsonResponse(200, {}));

    await expect(api.removeDailyCap("c1")).rejects.toThrow(
      "Expected no content from DELETE /currencies/c1/daily-cap, got 200.",
    );
  });
});

describe("errors", () => {
  test("an error body becomes an ApiError on its field", async () => {
    stubFetch(
      jsonResponse(409, {
        status: 409,
        message: "OAT is taken.",
        field: "abbreviation",
      }),
    );

    const error = await api
      .updateCurrencyDetails("c1", { name: "Oats", abbreviation: "OAT" })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "OAT is taken.",
      field: "abbreviation",
    });
  });

  test("a null field becomes undefined", async () => {
    stubFetch(
      jsonResponse(403, { status: 403, message: "Not yours.", field: null }),
    );

    const error = await api.listOwnedBots().catch((reason) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).field).toBeUndefined();
  });

  test("an error with maxAmount keeps it", async () => {
    stubFetch(
      jsonResponse(400, {
        status: 400,
        message: "Over the cap.",
        field: "amount",
        maxAmount: 500.25,
      }),
    );

    const error = await api.getQuote("a", "b", 1).catch((reason) => reason);

    expect(error).toBeInstanceOf(DailyCapError);
    expect((error as DailyCapError).maxAmount).toBe(500.25);
  });

  test("a response without an error body is a ConnectionError naming the status", async () => {
    stubFetch(new Response("Bad gateway", { status: 502 }));

    const error = await api.listCurrencies().catch((reason) => reason);

    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toContain("502");
  });

  test("a request that can't be sent is a ConnectionError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await api.setDailyCap("c1", 10).catch((reason) => reason);

    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toContain("Failed to fetch");
  });
});

describe("current user", () => {
  test("401 means logged out", async () => {
    stubFetch(
      jsonResponse(401, {
        status: 401,
        message: "Log in with Discord first.",
        field: null,
      }),
    );

    expect(await api.getMe()).toBeNull();
  });

  test("other failures still throw", async () => {
    stubFetch(
      jsonResponse(500, { status: 500, message: "Broken.", field: null }),
    );

    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);
  });

  test("logout posts and expects no content", async () => {
    const fetchMock = stubFetch(noContent());

    await api.logout();

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
  });
});

describe("webhook test", () => {
  test("posts to the test endpoint and returns the endpoint's status", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { status: 204 }));

    const status = await api.testWebhook("b1");

    const { url, init } = lastCall(fetchMock);
    expect(status).toBe(204);
    expect(url).toBe("/api/bots/b1/webhook-test");
    expect(init.method).toBe("POST");
  });

  test("a failing endpoint surfaces the API's message", async () => {
    stubFetch(
      jsonResponse(502, {
        status: 502,
        message: "Your webhook answered 500. Discoin expects a 2xx answer.",
        field: null,
      }),
    );

    await expect(api.testWebhook("b1")).rejects.toThrow(
      "Your webhook answered 500. Discoin expects a 2xx answer.",
    );
  });
});
