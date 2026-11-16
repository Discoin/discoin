import { API_BASE } from "../../api/http.js";
import { PHONE_QUERY } from "../../lib/breakpoints.js";
import { useMediaChange } from "../../lib/useMediaChange.js";
import {
  DisclosureTrigger,
  useDisclosure,
  usePopupDismissal,
} from "../shared/Disclosure.jsx";
import "./ResourcesMenu.scss";

interface ResourceLink {
  label: string;
  href: string;
}

const RESOURCE_LINKS: ResourceLink[] = [
  { label: "API Docs", href: `${API_BASE}/docs` },
];

export function ResourcesLabel() {
  return (
    <>
      Resources
      <svg
        class="resources-chevron"
        viewBox="0 0 16 16"
        width="12"
        height="12"
        aria-hidden="true"
      >
        <path d="M4 6l4 4l4-4" />
      </svg>
    </>
  );
}

interface ResourceLinksProps {
  id: string;
  class: string;
}

export function ResourceLinks({ id, class: className }: ResourceLinksProps) {
  return (
    <ul id={id} class={className}>
      {RESOURCE_LINKS.map((link) => (
        <li key={link.href}>
          <a href={link.href}>{link.label}</a>
        </li>
      ))}
    </ul>
  );
}

interface ResourcesPanelProps {
  id: string;
  onClose: () => void;
}

function ResourcesPanel({ id, onClose }: ResourcesPanelProps) {
  useMediaChange(PHONE_QUERY, (isPhone) => {
    if (isPhone) onClose();
  });

  return <ResourceLinks id={id} class="resources-menu__panel" />;
}

export function ResourcesMenu() {
  const disclosure = useDisclosure();
  const popup = usePopupDismissal(disclosure);

  return (
    <div
      ref={popup.rootRef}
      class="resources-menu"
      onKeyDown={popup.closeOnEscape}
    >
      <DisclosureTrigger
        disclosure={disclosure}
        class="resources-menu__trigger"
      >
        <ResourcesLabel />
      </DisclosureTrigger>
      {disclosure.isOpen && (
        <ResourcesPanel id={disclosure.panelId} onClose={disclosure.close} />
      )}
    </div>
  );
}
