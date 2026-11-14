import { useLocation } from "preact-iso";
import { api } from "../../api/client.js";
import type { Currency, CurrentUser } from "../../api/types.js";
import { AccountMenu } from "../session/AccountMenu.jsx";
import { useCurrentUser } from "../session/SessionProvider.jsx";
import { useRequest } from "../../lib/useRequest.js";
import { ThemeToggle } from "./ThemeToggle.jsx";
import { Ticker } from "./Ticker.jsx";
import { Wordmark } from "./Wordmark.jsx";
import "./Header.scss";

interface NavLink {
  href: string;
  label: string;
  shownTo: (user: CurrentUser | null) => boolean;
}

const LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", shownTo: () => true },
  {
    href: "/transactions",
    label: "My transactions",
    shownTo: (user) => user !== null,
  },
  {
    href: "/owner",
    label: "Bot owner",
    shownTo: (user) => user !== null && user.ownedCurrencyIds.length > 0,
  },
  { href: "/admin", label: "Admin", shownTo: (user) => user?.isAdmin === true },
];

function ReadyTicker({ currencies }: { currencies: Currency[] }) {
  if (currencies.length === 0) return null;

  return <Ticker currencies={currencies} />;
}

function PriceTicker() {
  const request = useRequest(() => api.listCurrencies(), []);
  const { state } = request;

  if (state.status === "ready") return <ReadyTicker currencies={state.data} />;

  return (
    <div class="site-header__ticker-note" role="status">
      {state.status === "loading" ? (
        "Loading prices"
      ) : (
        <>
          Prices didn't load.{" "}
          <button type="button" onClick={request.reload}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}

export function Header() {
  const { path } = useLocation();
  const user = useCurrentUser();

  return (
    <header class="site-header" data-prerendered-path={path}>
      <div class="site-header__bar">
        <a href="/" class="site-header__brand">
          <Wordmark />
        </a>
        <nav class="site-header__nav" aria-label="Main">
          {LINKS.filter((link) => link.shownTo(user)).map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={path === link.href ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <ThemeToggle />
        <AccountMenu />
      </div>
      <PriceTicker />
    </header>
  );
}
