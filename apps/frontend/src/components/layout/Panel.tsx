import type { ComponentChildren, Ref } from "preact";
import "./Panel.scss";

const HEADINGS = { 2: "h2", 3: "h3" } as const;

type HeadingLevel = keyof typeof HEADINGS;

interface PanelProps {
  id: string;
  title: string;
  level?: HeadingLevel;
  description?: ComponentChildren;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ComponentChildren;
}

export function Panel({
  id,
  title,
  level = 2,
  description,
  headingRef,
  children,
}: PanelProps) {
  const focusable = headingRef === undefined ? undefined : -1;
  const Heading = HEADINGS[level];

  return (
    <section class="panel" aria-labelledby={id}>
      <div class="panel__head">
        <Heading id={id} ref={headingRef} tabIndex={focusable}>
          {title}
        </Heading>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}
