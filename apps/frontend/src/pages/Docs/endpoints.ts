export const API_URL = "https://discoin.dev/api";

const OATS_ID = "0198a1c2-7f3e-7b10-9a4d-3c5e8f1b2a60";
const TICKETS_ID = "0198a1c2-7f3e-7c22-8b5e-4d6f9a2c3b71";
const TRANSACTION_ID = "019a7c3e-5b21-7a4f-9c3d-2e81f0a9b6d4";
const USER_ID = "412358906715234305";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT";

export interface FieldDoc {
  name: string;
  location: "Path" | "Query" | "Body";
  type: string;
  required: boolean;
  description: string;
}

export interface ErrorCase {
  status: number;
  when: string;
}

export interface Endpoint {
  id: string;
  method: HttpMethod;
  path: string;
  purpose: string;
  needsToken: boolean;
  fields: FieldDoc[];
  request: string;
  responseStatus: string;
  response: string;
  errors: ErrorCase[];
}

export interface EndpointGroup {
  id: string;
  title: string;
  intro: string;
  endpoints: Endpoint[];
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const OATS = {
  id: OATS_ID,
  abbreviation: "OAT",
  name: "Oats",
  reserve: 1250000,
  active: true,
  change24h: 0.0213,
  valueHistory: [0.97, 0.99, 1.02, 1.01, 1.04],
};

export const WEBHOOK_TRANSACTION = {
  id: TRANSACTION_ID,
  userId: USER_ID,
  fromCurrencyId: OATS_ID,
  toCurrencyId: TICKETS_ID,
  amount: 250,
  payout: 23.5,
  status: "Pending",
  submittedAt: "2026-11-20T14:02:11Z",
  handledAt: null,
};

const PENDING_TRANSACTION = {
  ...WEBHOOK_TRANSACTION,
  fromCurrency: { abbreviation: "OAT", name: "Oats", removed: false },
  toCurrency: { abbreviation: "TIC", name: "Tickets", removed: false },
};

const COMPLETED_TRANSACTION = {
  ...PENDING_TRANSACTION,
  status: "Completed",
  handledAt: "2026-11-20T14:02:40Z",
};

const REVERSED_TRANSACTION = {
  ...PENDING_TRANSACTION,
  status: "Reversed",
  handledAt: "2026-11-20T15:30:00Z",
};

const AMOUNT_FIELD: FieldDoc = {
  name: "amount",
  location: "Body",
  type: "number",
  required: true,
  description:
    "Coins to convert. Above 0, at most 2 decimals, at most 1,000,000,000.",
};

const MISSING_TOKEN: ErrorCase = {
  status: 401,
  when: "The token is missing or not valid.",
};

const CURRENCIES: EndpointGroup = {
  id: "currencies",
  title: "Currencies and market data",
  intro: "These endpoints are public and need no token.",
  endpoints: [
    {
      id: "get-currencies",
      method: "GET",
      path: "/currencies",
      purpose:
        "Lists the active currencies with their reserve and recent value.",
      needsToken: false,
      fields: [],
      request: `curl "${API_URL}/currencies"`,
      responseStatus: "200 OK",
      response: json([OATS]),
      errors: [],
    },
    {
      id: "get-currency",
      method: "GET",
      path: "/currencies/{abbreviation}",
      purpose: "Gets one currency by its abbreviation.",
      needsToken: false,
      fields: [
        {
          name: "abbreviation",
          location: "Path",
          type: "string",
          required: true,
          description: "3 or 4 letters, in any case.",
        },
      ],
      request: `curl ${API_URL}/currencies/OAT`,
      responseStatus: "200 OK",
      response: json(OATS),
      errors: [
        { status: 404, when: "No active currency has that abbreviation." },
      ],
    },
    {
      id: "get-quote",
      method: "GET",
      path: "/quote",
      purpose:
        "Tells you what a conversion would pay out right now, without making it.",
      needsToken: false,
      fields: [
        {
          name: "fromCurrencyId",
          location: "Query",
          type: "UUID",
          required: true,
          description: "The currency to convert from.",
        },
        {
          name: "toCurrencyId",
          location: "Query",
          type: "UUID",
          required: true,
          description: "The currency to convert into.",
        },
        { ...AMOUNT_FIELD, location: "Query" },
      ],
      request: `curl "${API_URL}/quote?fromCurrencyId=${OATS_ID}&toCurrencyId=${TICKETS_ID}&amount=250"`,
      responseStatus: "200 OK",
      response: json({ payout: 23.5 }),
      errors: [
        {
          status: 400,
          when: "A field is missing or not valid, both IDs are the same currency, a currency is inactive, or the amount is too small to pay out anything.",
        },
        {
          status: 404,
          when: "One of the currencies doesn't exist or was removed.",
        },
      ],
    },
  ],
};

const TRANSACTIONS: EndpointGroup = {
  id: "transactions",
  title: "Transactions",
  intro: "These endpoints need your bot's API token.",
  endpoints: [
    {
      id: "post-transactions",
      method: "POST",
      path: "/transactions",
      purpose:
        "Converts a user's coins from one of your bot's currencies into another currency. The transaction starts Pending until the receiving bot settles it.",
      needsToken: true,
      fields: [
        {
          name: "userId",
          location: "Body",
          type: "string",
          required: true,
          description: "The user's Discord ID.",
        },
        {
          name: "fromCurrencyId",
          location: "Body",
          type: "UUID",
          required: true,
          description:
            "The currency to convert from. It must be one of your bot's currencies.",
        },
        {
          name: "toCurrencyId",
          location: "Body",
          type: "UUID",
          required: true,
          description: "The currency to convert into.",
        },
        AMOUNT_FIELD,
      ],
      request: `curl -X POST ${API_URL}/transactions \\
  -H "Authorization: Bearer $DISCOIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"userId": "${USER_ID}", "fromCurrencyId": "${OATS_ID}", "toCurrencyId": "${TICKETS_ID}", "amount": 250}'`,
      responseStatus: "201 Created",
      response: json(PENDING_TRANSACTION),
      errors: [
        {
          status: 400,
          when: "A field is missing or not valid, both IDs are the same currency, a currency is inactive, or the amount is too small. Over the daily cap of the currency it converts into, the error also carries maxAmount, the most the user can convert now.",
        },
        MISSING_TOKEN,
        {
          status: 403,
          when: "fromCurrencyId is not one of your bot's currencies, or the user is blocked from these currencies.",
        },
        {
          status: 404,
          when: "One of the currencies doesn't exist or was removed.",
        },
      ],
    },
    {
      id: "get-pending-transactions",
      method: "GET",
      path: "/transactions/pending",
      purpose:
        "Lists the Pending transactions into your bot's currencies, so your bot can pay them out.",
      needsToken: true,
      fields: [
        {
          name: "currencyId",
          location: "Query",
          type: "UUID",
          required: false,
          description:
            "Only list transactions into this currency. It must be one of your bot's currencies. Without it, the list covers all of them.",
        },
      ],
      request: `curl ${API_URL}/transactions/pending \\
  -H "Authorization: Bearer $DISCOIN_TOKEN"`,
      responseStatus: "200 OK",
      response: json([PENDING_TRANSACTION]),
      errors: [
        { status: 400, when: "currencyId is not a UUID." },
        MISSING_TOKEN,
        {
          status: 403,
          when: "currencyId is not one of your bot's currencies.",
        },
        { status: 404, when: "currencyId doesn't exist or was removed." },
      ],
    },
    {
      id: "patch-transaction",
      method: "PATCH",
      path: "/transactions/{id}",
      purpose:
        "Settles a Pending transaction into one of your bot's currencies. Completed means your bot paid the user. Refunded sends the coins back to the currency they came from.",
      needsToken: true,
      fields: [
        {
          name: "id",
          location: "Path",
          type: "UUID",
          required: true,
          description: "The transaction's ID.",
        },
        {
          name: "status",
          location: "Body",
          type: "string",
          required: true,
          description: "Completed or Refunded.",
        },
      ],
      request: `curl -X PATCH ${API_URL}/transactions/${TRANSACTION_ID} \\
  -H "Authorization: Bearer $DISCOIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "Completed"}'`,
      responseStatus: "200 OK",
      response: json(COMPLETED_TRANSACTION),
      errors: [
        {
          status: 400,
          when: "status is not Completed or Refunded, or the transaction is no longer Pending.",
        },
        MISSING_TOKEN,
        {
          status: 403,
          when: "The transaction goes into another bot's currency.",
        },
        { status: 404, when: "No transaction has that ID." },
      ],
    },
    {
      id: "get-undone-transactions",
      method: "GET",
      path: "/transactions/undone",
      purpose:
        "Lists the Refunded, Cancelled and Reversed transactions your bot has not marked handled yet, oldest undone first. It covers transactions into your bot's currencies and out of them. The Undone transactions section below explains what to do with each one.",
      needsToken: true,
      fields: [
        {
          name: "currencyId",
          location: "Query",
          type: "UUID",
          required: false,
          description:
            "Only list transactions where this currency is your bot's side. It must be one of your bot's currencies. Without it, the list covers all of them.",
        },
        {
          name: "limit",
          location: "Query",
          type: "integer",
          required: false,
          description:
            "How many transactions to return, from 1 to 100. 50 if left out.",
        },
      ],
      request: `curl ${API_URL}/transactions/undone \\
  -H "Authorization: Bearer $DISCOIN_TOKEN"`,
      responseStatus: "200 OK",
      response: json([REVERSED_TRANSACTION]),
      errors: [
        {
          status: 400,
          when: "currencyId is not a UUID, or limit is not a whole number from 1 to 100.",
        },
        MISSING_TOKEN,
        {
          status: 403,
          when: "currencyId is not one of your bot's currencies.",
        },
        { status: 404, when: "currencyId doesn't exist or was removed." },
      ],
    },
    {
      id: "put-transaction-handled",
      method: "PUT",
      path: "/transactions/{id}/handled",
      purpose:
        "Marks an undone transaction as handled by your bot, so GET /transactions/undone stops returning it. It takes no body. Marking a transaction your bot already marked changes nothing.",
      needsToken: true,
      fields: [
        {
          name: "id",
          location: "Path",
          type: "UUID",
          required: true,
          description: "The transaction's ID.",
        },
      ],
      request: `curl -X PUT ${API_URL}/transactions/${TRANSACTION_ID}/handled \\
  -H "Authorization: Bearer $DISCOIN_TOKEN"`,
      responseStatus: "204 No Content",
      response: "",
      errors: [
        {
          status: 400,
          when: "id is not a UUID, or the transaction was not undone on your bot's side: it is still Pending or Completed, or it is Refunded and your bot only receives it.",
        },
        MISSING_TOKEN,
        {
          status: 403,
          when: "Neither currency of the transaction is one of your bot's.",
        },
        { status: 404, when: "No transaction has that ID." },
      ],
    },
  ],
};

const HAS_WEBHOOK_URL: ErrorCase = {
  status: 409,
  when: "Your bot has a webhook URL, so its events go to the webhook. Remove the URL on the Bot owner page to read events here.",
};

const EVENTS: EndpointGroup = {
  id: "events",
  title: "Events",
  intro:
    "These endpoints need your bot's API token and only work while your bot has no webhook URL. The event feed section below explains how to use them.",
  endpoints: [
    {
      id: "get-events",
      method: "GET",
      path: "/events",
      purpose:
        "Lists the events your bot has not acknowledged yet, oldest first. An empty list means nothing is new. A full batch means more are waiting, so call again at once.",
      needsToken: true,
      fields: [
        {
          name: "after",
          location: "Query",
          type: "integer",
          required: false,
          description:
            "List events with an ID above this one. Without it, the list starts after the last ID your bot acknowledged. It never moves that cursor.",
        },
        {
          name: "limit",
          location: "Query",
          type: "integer",
          required: false,
          description:
            "How many events to return, from 1 to 100. 100 if left out.",
        },
      ],
      request: `curl ${API_URL}/events \\
  -H "Authorization: Bearer $DISCOIN_TOKEN"`,
      responseStatus: "200 OK",
      response: json({
        events: [
          {
            id: 41,
            event: "transaction.created",
            transaction: WEBHOOK_TRANSACTION,
          },
        ],
      }),
      errors: [
        MISSING_TOKEN,
        HAS_WEBHOOK_URL,
        {
          status: 422,
          when: "after is not a whole number, or limit is not a whole number from 1 to 100.",
        },
      ],
    },
    {
      id: "post-events-ack",
      method: "POST",
      path: "/events/ack",
      purpose:
        "Acknowledges every event up to an ID, so GET /events stops returning them. Call it after your bot has handled them. An ID your bot already acknowledged changes nothing.",
      needsToken: true,
      fields: [
        {
          name: "id",
          location: "Body",
          type: "integer",
          required: true,
          description: "The highest event ID your bot has handled.",
        },
      ],
      request: `curl -X POST ${API_URL}/events/ack \\
  -H "Authorization: Bearer $DISCOIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"id": 41}'`,
      responseStatus: "204 No Content",
      response: "",
      errors: [
        {
          status: 400,
          when: "id is missing, not a whole number, or above your bot's newest event.",
        },
        MISSING_TOKEN,
        HAS_WEBHOOK_URL,
      ],
    },
  ],
};

export const ENDPOINT_GROUPS = [CURRENCIES, TRANSACTIONS, EVENTS];
