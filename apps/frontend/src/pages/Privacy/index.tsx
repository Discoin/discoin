import { PageIntro } from "../../components/layout/PageIntro.jsx";
import { TableFrame } from "../../components/shared/TableFrame.jsx";
import { DISCORD_INVITE_URL } from "../../lib/contact.js";
import { usePageTitle } from "../../lib/usePageTitle.js";
import "../../components/layout/Prose.scss";
import "../../components/shared/DataTable.scss";

const BASECAMP_POLICIES_URL = "https://github.com/basecamp/policies";
const CC_BY_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

interface StoredItem {
  name: string;
  kind: string;
  purpose: string;
  lifetime: string;
}

const STORED_ITEMS: StoredItem[] = [
  {
    name: "discoin_login_state",
    kind: "Cookie",
    purpose: "Checks that a Discord login really started on this site.",
    lifetime: "10 minutes, removed once you are logged in",
  },
  {
    name: "discoin_session",
    kind: "Cookie",
    purpose: "Keeps you logged in.",
    lifetime: "30 days, removed when you log out",
  },
  {
    name: "discoin-theme",
    kind: "Browser storage",
    purpose: "Remembers the light, dark or auto theme you picked.",
    lifetime: "Until you clear it",
  },
];

function DiscordServerLink() {
  return <a href={DISCORD_INVITE_URL}>Discoin Discord server</a>;
}

function StoredItemsTable() {
  return (
    <TableFrame label="Cookies and storage">
      <table class="data-table">
        <caption class="visually-hidden">Cookies and storage</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Purpose</th>
            <th scope="col">Lifetime</th>
          </tr>
        </thead>
        <tbody>
          {STORED_ITEMS.map((item) => (
            <tr key={item.name}>
              <td>
                <code>{item.name}</code>
              </td>
              <td>{item.kind}</td>
              <td>{item.purpose}</td>
              <td>{item.lifetime}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

function WhatWeCollect() {
  return (
    <section aria-labelledby="privacy-collect">
      <h2 id="privacy-collect">What we collect and why</h2>
      <p>
        We only collect what Discoin needs to work. Here is each kind of data
        and what it is for.
      </p>

      <h3>Identity and access</h3>
      <p>
        When you log in with Discord, we store your Discord user ID, display
        name and avatar, so we can show you your own account. We only ask
        Discord to identify you, so we never see your email address or your
        servers. Each login also creates a random login token that keeps you
        signed in.
      </p>

      <h3>Transactions</h3>
      <p>
        When a bot that supports Discoin sends a trade for you, we store your
        Discord user ID, the currencies, the amount, the payout, the status and
        the times. We need this to carry out the trade, and currency values are
        built from this history. This happens even if you never visit this site.
      </p>

      <h3>Blocks</h3>
      <p>
        If an admin or a bot owner blocks your Discord user ID, we store the
        reason, who blocked you and when. This keeps the exchange fair.
      </p>

      <h3>Bot owners</h3>
      <p>
        If you own a currency, it is linked to your Discord user ID, so you can
        manage it.
      </p>

      <h3>Website interactions</h3>
      <p>
        Our web servers record your IP address, the page you asked for, the time
        and your browser. We use these logs only to keep the site running and to
        stop abuse.
      </p>

      <h3>Advertising and cookies</h3>
      <p>
        Discoin runs no ads, no tracking and no analytics. We only use cookies
        and browser storage that the site needs to work, so there is nothing to
        agree to.
      </p>
      <StoredItemsTable />
      <p>
        You only get the two cookies if you log in. The theme is only saved once
        you change it. When the site runs through Cloudflare, Cloudflare may
        also set a security cookie named <code>__cf_bm</code> to filter out
        bots. It lasts 30 minutes.
      </p>
      <p>
        Logging out removes the login cookie. Clearing this site's data in your
        browser removes everything. You will then need to log in again.
      </p>
    </section>
  );
}

function WhenWeDisclose() {
  return (
    <section aria-labelledby="privacy-disclose">
      <h2 id="privacy-disclose">When we access or disclose your information</h2>
      <ul>
        <li>
          <strong>To provide the exchange you asked for.</strong> Currency bots
          receive the transactions that involve their currency, including your
          Discord user ID, so they can pay you out.
        </li>
        <li>
          <strong>To log you in.</strong> Discord handles the login when you
          choose to log in.
        </li>
        <li>
          <strong>To investigate, prevent or act on abuse.</strong> Admins and
          bot owners can see transactions and blocks to keep the exchange fair
          and secure.
        </li>
        <li>
          <strong>To run the site.</strong> Our hosting and network providers
          carry the traffic and store the data for us.
        </li>
        <li>
          <strong>When required under applicable law.</strong> We only hand over
          data when the law makes us.
        </li>
      </ul>
      <p>
        Our legal grounds are providing the service you asked for (trades and
        login) and our legitimate interest in a fair and secure exchange (blocks
        and server logs). We never sell your data and never use it for ads.
      </p>
    </section>
  );
}

function YourRights() {
  return (
    <section aria-labelledby="privacy-rights">
      <h2 id="privacy-rights">Your rights with respect to your information</h2>
      <p>We apply the same rights to everyone, wherever you live.</p>
      <ul>
        <li>
          <strong>Right to know.</strong> You can know what data we collect and
          why. That is what this page is for.
        </li>
        <li>
          <strong>Right of access.</strong> You can ask to see the data we hold
          about you.
        </li>
        <li>
          <strong>Right to correction.</strong> You can ask us to fix data that
          is wrong.
        </li>
        <li>
          <strong>Right to erasure.</strong> You can ask us to delete your data.
          If we can't delete something, we will tell you why.
        </li>
        <li>
          <strong>Right to restrict processing.</strong> You can ask us to stop
          using your data while a question about it is open.
        </li>
        <li>
          <strong>Right to object.</strong> You can object to how we use your
          data.
        </li>
        <li>
          <strong>Right to portability.</strong> You can ask for a copy of your
          data in a common format.
        </li>
        <li>
          <strong>Right to complain.</strong> You can complain to the data
          protection authority where you live.
        </li>
      </ul>
      <p>
        To use any of these rights, ask in the <DiscordServerLink />. We answer
        within one month.
      </p>
    </section>
  );
}

function HowWeHandleData() {
  return (
    <>
      <section aria-labelledby="privacy-security">
        <h2 id="privacy-security">How we secure your data</h2>
        <p>
          The login cookies are only sent over an encrypted connection and can't
          be read by scripts on the page. We store your login token only in
          scrambled form, so nobody who reads our database can use it to log in
          as you.
        </p>
      </section>

      <section aria-labelledby="privacy-retention">
        <h2 id="privacy-retention">Data retention</h2>
        <p>
          We keep your information for as long as we need it for the purpose we
          collected it for. Transactions, blocks and account details stay for as
          long as Discoin runs, because currency values are built from that
          history. A login lasts 30 days, and logging out ends it right away.
        </p>
      </section>

      <section aria-labelledby="privacy-location">
        <h2 id="privacy-location">Location of site and data</h2>
        <p>Discoin is hosted in the EU, and your data is stored there.</p>
      </section>
    </>
  );
}

function ChangesAndQuestions() {
  return (
    <section aria-labelledby="privacy-changes">
      <h2 id="privacy-changes">Changes and questions</h2>
      <p>
        We may update this policy to follow the law or to reflect a change in
        what Discoin does. When we make a significant change, we refresh the
        date at the top of this page.
      </p>
      <p>
        Discoin is run by the Discoin team. If you have a question about this
        policy, your data or your rights, ask us in the <DiscordServerLink />.
      </p>
      <p class="prose__credit">
        Adapted from the{" "}
        <a href={BASECAMP_POLICIES_URL}>Basecamp open-source policies</a> /{" "}
        <a href={CC_BY_LICENSE_URL}>CC BY 4.0</a>
      </p>
    </section>
  );
}

export function Privacy() {
  usePageTitle("Privacy and cookies");

  return (
    <article class="prose">
      <PageIntro title="Privacy and cookies">
        The privacy of your data is a big deal to us. This policy lays out what
        data we collect and why, how your data is handled, and your rights with
        respect to your data. We never sell your data.
      </PageIntro>
      <p class="prose__updated">Last updated November 15, 2026.</p>

      <WhatWeCollect />
      <WhenWeDisclose />
      <YourRights />
      <HowWeHandleData />
      <ChangesAndQuestions />
    </article>
  );
}
