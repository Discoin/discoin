import { useLocation } from "preact-iso";
import { api } from "../../api/client.js";
import type { Currency } from "../../api/types.js";
import { AccountMenu } from "../session/AccountMenu.jsx";
import { useRequest } from "../../lib/useRequest.js";
import { MainNav } from "./MainNav.jsx";
import { NavDrawer } from "./NavDrawer.jsx";
import { ResourcesMenu } from "./ResourcesMenu.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";
import { Ticker } from "./Ticker.jsx";
import { Wordmark } from "./Wordmark.jsx";
import "./Header.scss";

const DOCS_PATH = "/docs";

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

function showsPrices(path: string): boolean {
  return !path.startsWith(DOCS_PATH);
}

export function Header() {
  const { path } = useLocation();

  return (
    <header class="site-header" data-prerendered-path={path}>
      <div class="site-header__bar">
        <a href="/" class="site-header__brand">
          <Wordmark />
        </a>
        <MainNav class="site-header__nav" />
        <ResourcesMenu />
        <ThemeToggle />
        <AccountMenu />
        <NavDrawer />
      </div>
      {showsPrices(path) && <PriceTicker />}
    </header>
  );
}
