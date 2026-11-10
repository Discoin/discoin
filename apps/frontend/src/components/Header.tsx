import { useLocation } from "preact-iso";

export function Header() {
  const { url } = useLocation();
  const activeClass = (path: string) => (url === path ? "active" : undefined);

  return (
    <header>
      <nav>
        <a href="/" class={activeClass("/")}>
          Home
        </a>
        <a href="/404" class={activeClass("/404")}>
          404
        </a>
      </nav>
    </header>
  );
}
