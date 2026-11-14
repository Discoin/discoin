import type { ComponentChildren } from "preact";
import "./Notice.scss";

export type NoticeTone = "error" | "warning" | "info";

interface NoticeProps {
  tone: NoticeTone;
  title: string;
  children: ComponentChildren;
}

export function Notice({ tone, title, children }: NoticeProps) {
  return (
    <div
      class={`notice notice--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <p class="notice__title">{title}</p>
      <div class="notice__body">{children}</div>
    </div>
  );
}
