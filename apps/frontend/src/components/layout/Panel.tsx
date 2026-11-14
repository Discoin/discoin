import type { ComponentChildren } from "preact";
import "./Panel.scss";

interface PanelProps {
  id: string;
  title: string;
  description?: ComponentChildren;
  children: ComponentChildren;
}

export function Panel({ id, title, description, children }: PanelProps) {
  return (
    <section class="panel" aria-labelledby={id}>
      <div class="panel__head">
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}
