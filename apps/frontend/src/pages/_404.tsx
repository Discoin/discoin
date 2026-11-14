import { usePageTitle } from "../lib/usePageTitle.js";

export function NotFound() {
  usePageTitle("Page not found");

  return (
    <section>
      <h1>404: Not Found</h1>
      <p>It's gone :(</p>
    </section>
  );
}
