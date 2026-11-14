import type { ComponentChildren } from "preact";
import "./EmptyState.scss";

interface EmptyStateProps {
  title: string;
  children: ComponentChildren;
}

export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div class="empty-state">
      <p class="empty-state__title">{title}</p>
      <div class="empty-state__body">{children}</div>
    </div>
  );
}
