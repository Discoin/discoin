import {
  LocationProvider,
  Router,
  Route,
  hydrate,
  prerender as ssr,
} from "preact-iso";

import { Header } from "./components/Header.jsx";
import { Home } from "./pages/Home/index.jsx";
import { NotFound } from "./pages/_404.jsx";
import "./style.scss";

export function App() {
  return (
    <LocationProvider>
      <Header />
      <main>
        <Router>
          <Route path="/" component={Home} />
          <Route default component={NotFound} />
        </Router>
      </main>
    </LocationProvider>
  );
}

if (typeof window !== "undefined") {
  hydrate(<App />, getAppRoot());
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
