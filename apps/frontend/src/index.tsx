import { render } from "preact";
import {
  LocationProvider,
  Router,
  Route,
  hydrate,
  prerender as ssr,
} from "preact-iso";

import { Header } from "./components/layout/Header.jsx";
import { SessionProvider } from "./components/session/SessionProvider.jsx";
import { Toaster } from "./components/shared/Toaster.jsx";
import { Admin } from "./pages/Admin/index.jsx";
import { BotOwner } from "./pages/BotOwner/index.jsx";
import { CurrencyPage } from "./pages/Currency/index.jsx";
import { Dashboard } from "./pages/Dashboard/index.jsx";
import { MyTransactions } from "./pages/MyTransactions/index.jsx";
import { NotFound } from "./pages/_404.jsx";
import "@fontsource-variable/instrument-sans/standard.css";
import "@fontsource-variable/martian-mono/standard.css";
import "./style.scss";

const APP_ROUTES = /^\/(?!api(\/|$))/;

export function App() {
  return (
    <LocationProvider scope={APP_ROUTES}>
      <SessionProvider>
        <a class="skip-link" href="#main">
          Skip to content
        </a>
        <Header />
        <main id="main" tabIndex={-1}>
          <Router>
            <Route path="/" component={Dashboard} />
            <Route path="/currency/:abbreviation" component={CurrencyPage} />
            <Route path="/transactions" component={MyTransactions} />
            <Route path="/owner" component={BotOwner} />
            <Route path="/admin" component={Admin} />
            <Route default component={NotFound} />
          </Router>
        </main>
        <Toaster />
      </SessionProvider>
    </LocationProvider>
  );
}

if (typeof window !== "undefined") {
  startApp(getAppRoot());
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function isPrerenderedForThisPage(root: HTMLElement): boolean {
  const prerenderedPath = root
    .querySelector("[data-prerendered-path]")
    ?.getAttribute("data-prerendered-path");

  return (
    prerenderedPath != null &&
    withoutTrailingSlash(prerenderedPath) ===
      withoutTrailingSlash(window.location.pathname)
  );
}

function startApp(root: HTMLElement): void {
  if (isPrerenderedForThisPage(root)) {
    hydrate(<App />, root);

    return;
  }

  root.replaceChildren();
  render(<App />, root);
}

function getAppRoot(): HTMLElement {
  const root = document.getElementById("app");
  if (root === null) {
    throw new Error('Missing root element with id "app"');
  }

  return root;
}

export async function prerender(data: object) {
  return await ssr(<App {...data} />);
}
