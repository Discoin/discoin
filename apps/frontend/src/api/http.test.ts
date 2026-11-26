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

  test.each([
    {
      name: "a currency by its encoded abbreviation",
      call: () => api.getCurrency("a/b"),
      answer: jsonResponse(200, {}),
      method: "GET",
      url: "/api/currencies/a%2Fb",
      returns: {},
    },
    {
      name: "a transaction by its encoded ID",
      call: () => api.getTransaction("a/b"),
      answer: jsonResponse(200, {}),
      method: "GET",
      url: "/api/transactions/a%2Fb",
      returns: {},
    },
    {
      name: "history for a window in days",
      call: () => api.getReserveHistory("c1", 7),
      answer: jsonResponse(200, []),
      method: "GET",
      url: "/api/currencies/c1/history?days=7",
      returns: [],
    },
    {
      name: "a quote for both currencies and the amount",
      call: () => api.getQuote("a", "b", 1000),
      answer: jsonResponse(200, { payout: 99.9 }),
      method: "GET",
      url: "/api/quote?fromCurrencyId=a&toCurrencyId=b&amount=1000",
      returns: 99.9,
    },
    {
      name: "a regenerated token as plain text",
      call: () => api.regenerateApiToken("b1"),
      answer: jsonResponse(200, { token: "dsc_abc" }),
      method: "POST",
      url: "/api/bots/b1/api-token",
      returns: "dsc_abc",
    },
    {
      name: "a webhook secret for the bot",
      call: () => api.generateWebhookSecret("b1"),
      answer: jsonResponse(200, { secret: "whsec_abc" }),
      method: "POST",
      url: "/api/bots/b1/webhook-secret",
      returns: "whsec_abc",
    },
    {
      name: "removing the bot's webhook URL",
      call: () => api.removeWebhookUrl("b1"),
      answer: noContent(),
      method: "DELETE",
      url: "/api/bots/b1/webhook-url",
      returns: undefined,
    },
    {
      name: "the bot's pending list",
      call: () => api.listPendingTransactions("b1"),
      answer: jsonResponse(200, []),
      method: "GET",
      url: "/api/bots/b1/transactions/pending",
      returns: [],
    },
    {
      name: "an unblock under the bot",
      call: () => api.botBlocks("b1").unblock("530917284650193847"),
      answer: noContent(),
      method: "DELETE",
      url: "/api/bots/b1/blocks/530917284650193847",
      returns: undefined,
    },
    {
      name: "a logout",
      call: () => api.logout(),
      answer: noContent(),
      method: "POST",
      url: "/api/auth/logout",
      returns: undefined,
    },
    {
      name: "a started webhook test, returning its ID and path",
      call: () => api.startWebhookTest("b1"),
      answer: jsonResponse(202, { testId: "t1", path: "feed" }),
      method: "POST",
      url: "/api/bots/b1/webhook-test",
      returns: { testId: "t1", path: "feed" },
    },
    {
      name: "a webhook test's progress by its encoded ID",
      call: () => api.getWebhookTest("b1", "t/1"),
      answer: jsonResponse(200, {
        state: "handled",
        path: "webhook",
        markedStatus: "Refunded",
      }),
      method: "GET",
      url: "/api/bots/b1/webhook-test/t%2F1",
      returns: { state: "handled", path: "webhook", markedStatus: "Refunded" },
    },
  ])(
    "$name goes to $method $url",
    async ({ call, answer, method, url, returns }) => {
      const fetchMock = stubFetch(answer);

      const result = await call();

      expect(lastCall(fetchMock).url).toBe(url);
      expect(lastCall(fetchMock).init.method).toBe(method);
      expect(result).toEqual(returns);
    },
  );

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
});

describe("webhook test", () => {
  test("a failing endpoint surfaces the API's message", async () => {
    stubFetch(
      jsonResponse(502, {
        status: 502,
        message: "Your webhook answered 500. Discoin expects a 2xx answer.",
        field: null,
      }),
    );

    await expect(api.startWebhookTest("b1")).rejects.toThrow(
      "Your webhook answered 500. Discoin expects a 2xx answer.",
    );
  });

  test("an expired test is the API's 404", async () => {
    stubFetch(
      jsonResponse(404, {
        status: 404,
        message: "No webhook test with that ID.",
        field: null,
      }),
    );

    await expect(api.getWebhookTest("b1", "t1")).rejects.toMatchObject({
      status: 404,
      message: "No webhook test with that ID.",
    });
  });
});
