import type { ComponentChildren } from "preact";
import { useLocation } from "preact-iso";
import type { CurrentUser } from "../../api/types.js";
import { useCurrentUser } from "../session/SessionProvider.jsx";

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
    shownTo: (user) => user !== null && user.ownedBots.length > 0,
  },
  { href: "/admin", label: "Admin", shownTo: (user) => user?.isAdmin === true },
];

interface MainNavProps {
  class: string;
  children?: ComponentChildren;
}

export function MainNav({ class: className, children }: MainNavProps) {
  const { path } = useLocation();
  const user = useCurrentUser();

  return (
    <nav class={className} aria-label="Main">
      {LINKS.filter((link) => link.shownTo(user)).map((link) => (
        <a
          key={link.href}
          href={link.href}
          aria-current={path === link.href ? "page" : undefined}
        >
          {link.label}
        </a>
      ))}
      {children}
    </nav>
  );
}
