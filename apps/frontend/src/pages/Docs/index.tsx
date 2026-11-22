import type { ComponentChildren } from "preact";
import { PageIntro } from "../../components/layout/PageIntro.jsx";
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
        Once a Discoin admin has registered your bot, generate its API token and
        set its webhook on the <a href="/owner">Bot owner page</a>.
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
      <CodeSample
        title={`Response ${endpoint.responseStatus}`}
        code={endpoint.response}
        label={`${title} response`}
      />
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

function Webhooks() {
  return (
    <DocSection heading={WEBHOOKS}>
      <p>
        Set your bot's webhook URL on the Bot owner page. It also gives you a
        secret that starts with <code>whsec_</code>. Discoin posts an event to
        that URL whenever something happens to a transaction into one of your
        bot's currencies. Webhooks only go to public https addresses.
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
          owner page. Check its signature, then ignore it.
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
        redirect is retried, since redirects are not followed. The first retry
        comes after 10 seconds, and each wait doubles up to 1 hour, for at most
        10 retries. After that the transaction stays as it is, so poll{" "}
        <code>GET /transactions/pending</code> to catch anything you missed.
      </p>
    </DocSection>
  );
}

export function Docs() {
  usePageTitle("API docs");

  return (
    <article class="prose docs">
      <PageIntro title="API docs">
        Everything your bot needs to trade on Discoin: market data, transactions
        and webhooks.
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
          <Webhooks />
        </div>
      </div>
    </article>
  );
}
