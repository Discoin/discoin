import type { ComponentChildren } from "preact";
import { PageIntro } from "../../components/layout/PageIntro.jsx";
import { TableFrame } from "../../components/shared/TableFrame.jsx";
import { usePageTitle } from "../../lib/usePageTitle.js";
import {
  API_URL,
  ENDPOINT_GROUPS,
  json,
  WEBHOOK_TRANSACTION,
  type Endpoint,
  type EndpointGroup,
  type ErrorCase,
  type FieldDoc,
} from "./endpoints.js";
import { CodeSample } from "./CodeSample.jsx";
import { VerificationSample } from "./VerificationSample.jsx";
import "../../components/layout/Prose.scss";
import "./style.scss";

interface DocSectionHeading {
  id: string;
  title: string;
}

const OVERVIEW = { id: "overview", title: "Overview" };
const AUTHENTICATION = { id: "authentication", title: "Authentication" };
const ERRORS = { id: "errors", title: "Errors" };
const RATE_LIMITS = { id: "rate-limits", title: "Rate limits" };
const UNDONE_TRANSACTIONS = {
  id: "undone-transactions",
  title: "Undone transactions",
};
const EVENT_FEED = { id: "event-feed", title: "Event feed" };
const WEBHOOKS = { id: "webhooks", title: "Webhooks" };
const LEADING_SECTIONS = [OVERVIEW, AUTHENTICATION, ERRORS, RATE_LIMITS];

const ERROR_EXAMPLE = json({
  status: 400,
  message: "Enter a Discord user ID, like 412358906715234305.",
  field: "userId",
});

const COMMON_ERRORS: ErrorCase[] = [
  { status: 400, when: "A field is missing or not valid." },
  { status: 401, when: "The token is missing or not valid." },
  {
    status: 403,
    when: "The currency or transaction belongs to another bot, or the user is blocked.",
  },
  { status: 404, when: "The currency or transaction doesn't exist." },
  { status: 429, when: "Too many requests. See rate limits below." },
  { status: 500, when: "Something failed on our side. Try again later." },
];

const WEBHOOK_EXAMPLE = json({
  id: 4182,
  event: "transaction.created",
  transaction: WEBHOOK_TRANSACTION,
});

const GIVE_THE_AMOUNT_BACK = "Give the amount back to the user.";
const UNDONE_JOBS = [
  {
    status: "Refunded",
    receiving: "Not listed. Your bot refunded it itself.",
    sending: GIVE_THE_AMOUNT_BACK,
  },
  {
    status: "Cancelled",
    receiving:
      "Stop waiting for it. Your bot never paid, so there is nothing to take back.",
    sending: GIVE_THE_AMOUNT_BACK,
  },
  {
    status: "Reversed",
    receiving: "Take the payout back from the user.",
    sending: GIVE_THE_AMOUNT_BACK,
  },
];

function endpointTitle(endpoint: Endpoint): string {
  return `${endpoint.method} ${endpoint.path}`;
}

interface DocSectionProps {
  heading: DocSectionHeading;
  children: ComponentChildren;
}

function DocSection({ heading, children }: DocSectionProps) {
  return (
    <section aria-labelledby={heading.id}>
      <h2 id={heading.id}>{heading.title}</h2>
      {children}
    </section>
  );
}

function StatusList({ cases }: { cases: ErrorCase[] }) {
  return (
    <dl class="docs-statuses">
      {cases.map((errorCase) => (
        <div key={errorCase.status}>
          <dt>
            <code>{errorCase.status}</code>
          </dt>
          <dd>{errorCase.when}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionLinks() {
  return (
    <nav aria-label="On this page" class="docs-contents">
      <ul>
        {LEADING_SECTIONS.map((heading) => (
          <SectionLink key={heading.id} heading={heading} />
        ))}
        {ENDPOINT_GROUPS.map((group) => (
          <li key={group.id}>
            <a href={`#${group.id}`}>{group.title}</a>
            <ul>
              {group.endpoints.map((endpoint) => (
                <li key={endpoint.id}>
                  <a href={`#${endpoint.id}`}>
                    <code>{endpointTitle(endpoint)}</code>
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
        <SectionLink heading={UNDONE_TRANSACTIONS} />
        <SectionLink heading={EVENT_FEED} />
        <SectionLink heading={WEBHOOKS} />
      </ul>
    </nav>
  );
}

function SectionLink({ heading }: { heading: DocSectionHeading }) {
  return (
    <li>
      <a href={`#${heading.id}`}>{heading.title}</a>
    </li>
  );
}

function Overview() {
  return (
    <DocSection heading={OVERVIEW}>
      <p>
        Discoin's API lets your Discord bot read market data and convert its
        users' coins into other bots' currencies. Every endpoint lives under{" "}
        <code>{API_URL}</code>. Requests and responses are JSON with camelCase
        names, and money is a JSON number with at most 2 decimals.
      </p>
      <p>
        Once a Discoin admin has registered your bot, generate its API token on
        the <a href="/owner">Bot owner page</a>. To hear about transactions, set
        a webhook there if your bot is a web service, or leave it unset and poll
        the event feed.
      </p>
    </DocSection>
  );
}

function Authentication() {
  return (
    <DocSection heading={AUTHENTICATION}>
      <p>
        Send your token in the <code>Authorization</code> header on every
        transaction request. Tokens start with <code>dsc_</code>.
      </p>
      <CodeSample
        title="Header"
        code="Authorization: Bearer dsc_your_token"
        label="Authorization header example"
      />
      <ul>
        <li>
          The token identifies your bot, not a currency, so a bot with several
          currencies uses one token for all of them.
        </li>
        <li>
          Tokens from before bots existed no longer work. Generate a new one on
          the Bot owner page.
        </li>
        <li>
          A missing or invalid token gets a <code>401</code>. A currency or
          transaction that belongs to another bot gets a <code>403</code>.
        </li>
      </ul>
    </DocSection>
  );
}

function Errors() {
  return (
    <DocSection heading={ERRORS}>
      <p>
        Every error has the same shape. <code>field</code> names the input at
        fault, or is <code>null</code> when no single input is.
      </p>
      <CodeSample
        title="Error body"
        code={ERROR_EXAMPLE}
        label="Error example"
      />
      <StatusList cases={COMMON_ERRORS} />
    </DocSection>
  );
}

function RateLimits() {
  return (
    <DocSection heading={RATE_LIMITS}>
      <p>
        Each IP address can make 1200 requests a minute, and each token 300 a
        minute. Over either limit, the API answers <code>429</code> with a{" "}
        <code>Retry-After: 60</code> header. Wait that many seconds before
        trying again.
      </p>
    </DocSection>
  );
}

function parameterKind(field: FieldDoc): string {
  const need = field.required ? "required" : "optional";

  return `${field.type}, in ${field.location.toLowerCase()}, ${need}`;
}

function EndpointParameters({ fields }: { fields: FieldDoc[] }) {
  return (
    <div class="docs-parameters">
      <h4 class="docs-parameters__title">Parameters</h4>
      <dl class="docs-parameters__list">
        {fields.map((field) => (
          <div key={field.name}>
            <dt>
              <code>{field.name}</code>
            </dt>
            <dd class="docs-parameters__kind">{parameterKind(field)}</dd>
            <dd class="docs-parameters__description">{field.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EndpointErrors({ cases }: { cases: ErrorCase[] }) {
  return (
    <>
      <h4>Errors</h4>
      <StatusList cases={cases} />
    </>
  );
}

function EndpointBlock({ endpoint }: { endpoint: Endpoint }) {
  const title = endpointTitle(endpoint);

  return (
    <section aria-labelledby={endpoint.id} class="docs-endpoint">
      <div class="docs-endpoint__strip">
        <h3 id={endpoint.id}>
          <code>
            <span class="docs-endpoint__method">{endpoint.method}</span>{" "}
            {endpoint.path}
          </code>
        </h3>
        <p>
          {endpoint.needsToken ? "Needs your API token" : "No token needed"}
        </p>
      </div>
      <p>{endpoint.purpose}</p>
      {endpoint.fields.length > 0 && (
        <EndpointParameters fields={endpoint.fields} />
      )}
      <CodeSample
        title="Request"
        code={endpoint.request}
        label={`${title} request`}
      />
      {endpoint.response === "" ? (
        <p>
          Answers <code>{endpoint.responseStatus}</code> with no body.
        </p>
      ) : (
        <CodeSample
          title={`Response ${endpoint.responseStatus}`}
          code={endpoint.response}
          label={`${title} response`}
        />
      )}
      {endpoint.errors.length > 0 && <EndpointErrors cases={endpoint.errors} />}
    </section>
  );
}

function EndpointSection({ group }: { group: EndpointGroup }) {
  return (
    <DocSection heading={group}>
      <p>{group.intro}</p>
      {group.endpoints.map((endpoint) => (
        <EndpointBlock key={endpoint.id} endpoint={endpoint} />
      ))}
    </DocSection>
  );
}

function UndoneJobsTable() {
  const label = "What to do with an undone transaction";

  return (
    <TableFrame label={label}>
      <table class="data-table">
        <caption class="visually-hidden">{label}</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Into one of your currencies</th>
            <th scope="col">Out of one of your currencies</th>
          </tr>
        </thead>
        <tbody>
          {UNDONE_JOBS.map((job) => (
            <tr key={job.status}>
              <td>{job.status}</td>
              <td>{job.receiving}</td>
              <td>{job.sending}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function UndoneTransactions() {
  return (
    <DocSection heading={UNDONE_TRANSACTIONS}>
      <p>
        A transaction is undone when it becomes Refunded, Cancelled or Reversed.{" "}
        <code>GET /transactions/undone</code> lists every undone transaction
        your bot still has to deal with, on both sides: the ones into your
        currencies and the ones out of them. Compare <code>fromCurrencyId</code>{" "}
        and <code>toCurrencyId</code> with your own currencies to see which side
        your bot is on.
      </p>
      <UndoneJobsTable />
      <p>
        If your bot runs both currencies of a transaction, it is listed once. Do
        both jobs, then mark it once.
      </p>
      <p>
        This list, not the event feed and not webhooks, is how your bot recovers
        a reversal it missed. It is also the only way a sending bot learns that
        its transaction was refunded, cancelled or reversed, because events only
        go to the receiving bot.
      </p>

      <h3>Read, act, mark</h3>
      <ol>
        <li>
          When your bot starts, and then about once a minute, call{" "}
          <code>GET /transactions/undone</code>.
        </li>
        <li>
          For each transaction, move the coins as the table says and save in
          your own records that you did. Check those records first, so a
          transaction you already acted on never moves coins twice.
        </li>
        <li>
          Send <code>PUT /transactions/{"{id}"}/handled</code>. Marking twice is
          safe, so repeat it if your bot stopped before the answer came back.
        </li>
        <li>
          A full batch means more can be waiting, so call again once you have
          marked every transaction in it.
        </li>
      </ol>
      <p>
        Mark every transaction you receive, even one your bot can only log. The
        list has no cursor: a transaction you never mark comes back first on
        every call. A delivered webhook or an acknowledged feed event does not
        mark anything, so a reversal your bot already handled from an event
        still shows up here. Skip the coins, then mark it.
      </p>
      <p>
        Transactions of an inactive or removed currency stay on the list, with{" "}
        <code>removed: true</code> on that side. The <code>currencyId</code>{" "}
        filter answers <code>404</code> for a removed currency, so call without
        it to see them.
      </p>
    </DocSection>
  );
}

function EventFeed() {
  return (
    <DocSection heading={EVENT_FEED}>
      <p>
        The event feed is for bots with no public address. Your bot asks{" "}
        <code>GET /events</code> for what happened to transactions into its
        currencies, with its normal API token. It needs no URL, no secret and no
        signature check.
      </p>
      <p>
        A bot uses a webhook or the event feed, not both. While your bot has a
        webhook URL, every event goes to the webhook and both feed endpoints
        answer <code>409</code>. Treat that as final: stop polling and remove
        the URL on the Bot owner page, or use the webhook.
      </p>

      <h3>Polling</h3>
      <ol>
        <li>
          When your bot starts, read <code>GET /transactions/pending</code> and{" "}
          <code>GET /transactions/undone</code> and handle what is there.
        </li>
        <li>
          Call <code>GET /events</code> about every 2 seconds and handle the
          events in <code>id</code> order. They are the same events, with the
          same body, as the ones listed under Webhooks.
        </li>
        <li>
          After handling them, send the highest <code>id</code> to{" "}
          <code>POST /events/ack</code>. Discoin keeps that cursor, so your bot
          picks up where it stopped after a restart.
        </li>
        <li>A full batch means more are waiting, so call again at once.</li>
      </ol>

      <h3>Duplicates</h3>
      <p>
        Your bot can get an event twice: when it stops between handling an event
        and acknowledging it, and when the owner resends a transaction from the
        Bot owner page. Skip an event when you already handled that transaction{" "}
        <code>id</code> with that <code>event</code>.
      </p>

      <h3>Expiry</h3>
      <p>
        Discoin keeps an event for 24 hours, then deletes it whether your bot
        read it or not. There is no error for that: <code>GET /events</code>{" "}
        returns what is still stored. If your bot was offline for more than 24
        hours, the older events are gone without notice, so read{" "}
        <code>GET /transactions/pending</code> and{" "}
        <code>GET /transactions/undone</code> when it starts to catch up.
      </p>

      <h3>Switching</h3>
      <ul>
        <li>
          Saving a webhook URL switches the feed off and deletes the events your
          bot had not read. They are not sent to the webhook, so read{" "}
          <code>GET /transactions/pending</code> and{" "}
          <code>GET /transactions/undone</code> to catch up.
        </li>
        <li>
          Removing the webhook URL switches the feed on, and it starts empty.
          Events already queued for the webhook are not moved to the feed, so
          read <code>GET /transactions/pending</code> and{" "}
          <code>GET /transactions/undone</code> here too.
        </li>
      </ul>
    </DocSection>
  );
}

function Webhooks() {
  return (
    <DocSection heading={WEBHOOKS}>
      <p>
        Set your bot's webhook URL on the Bot owner page. It also gives you a
        secret that starts with <code>whsec_</code>. Discoin posts an event to
        that URL whenever something happens to a transaction into one of your
        bot's currencies. Webhooks only go to public https addresses. A bot with
        a webhook URL gets its events there and can't read the event feed.
      </p>

      <h3>Events</h3>
      <ul>
        <li>
          <code>transaction.created</code>: a user converted into one of your
          currencies. Pay them, then settle it with{" "}
          <code>PATCH /transactions/{"{id}"}</code>.
        </li>
        <li>
          <code>transaction.cancelled</code>: a Pending transaction was
          cancelled, for example because the user was blocked. Don't pay it.
        </li>
        <li>
          <code>transaction.reversed</code>: a Completed transaction was
          reversed.
        </li>
        <li>
          <code>transaction.test</code>: sent by the Test button on the Bot
          owner page. On a webhook, check its signature, then ignore it. In the
          event feed, acknowledge it like any other event.
        </li>
      </ul>

      <h3>Payload</h3>
      <p>
        The body is JSON with <code>id</code>, <code>event</code>,{" "}
        <code>transaction</code> and, on events caused by a block,{" "}
        <code>triggeredBy</code>. Retries carry the same <code>id</code>, so you
        can skip one you already handled.
      </p>
      <CodeSample title="Body" code={WEBHOOK_EXAMPLE} label="Webhook payload" />

      <h3>Signature</h3>
      <p>
        Every request carries a <code>Discoin-Signature</code> header like{" "}
        <code>5257a869...</code>. It is the hex HMAC SHA256 of the raw body,
        keyed with your secret.
      </p>
      <ol>
        <li>Read the raw body before you parse it.</li>
        <li>Compute the HMAC SHA256 of the raw body with your secret.</li>
        <li>Compare it to the header in constant time.</li>
      </ol>
      <VerificationSample />

      <h3>Retries</h3>
      <p>
        A 2xx answer counts as delivered. Any other answer, a timeout or a
        redirect is retried, since redirects are not followed. Discoin tries 8
        times in all. The first retry comes after 1 minute and each wait
        doubles, up to 64 minutes before the last try, about 2 hours in total.
        After that the transaction stays as it is, so poll{" "}
        <code>GET /transactions/pending</code> and{" "}
        <code>GET /transactions/undone</code> to catch anything you missed.
      </p>
    </DocSection>
  );
}

export function Docs() {
  usePageTitle("API docs");

  return (
    <article class="prose docs">
      <PageIntro title="API docs">
        Everything your bot needs to trade on Discoin: market data,
        transactions, the event feed and webhooks.
      </PageIntro>

      <div class="docs__layout">
        <SectionLinks />
        <div class="docs__body">
          <Overview />
          <Authentication />
          <Errors />
          <RateLimits />
          {ENDPOINT_GROUPS.map((group) => (
            <EndpointSection key={group.id} group={group} />
          ))}
          <UndoneTransactions />
          <EventFeed />
          <Webhooks />
        </div>
      </div>
    </article>
  );
}
