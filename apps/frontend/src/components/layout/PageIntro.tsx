import type { ComponentChildren } from "preact";
import "./PageIntro.scss";

interface PageIntroProps {
  title: string;
  children: ComponentChildren;
}

export function PageIntro({ title, children }: PageIntroProps) {
  return (
    <div class="page-intro">
      <h1>{title}</h1>
      <p>{children}</p>
    </div>
  );
}
