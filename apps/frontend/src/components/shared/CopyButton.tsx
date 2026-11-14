import { useState } from "preact/hooks";
import { Button } from "./Button.jsx";

type CopyState = "idle" | "copied" | "failed";

const BUTTON_TEXT: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Copy failed",
};

interface CopyButtonProps {
  text: string;
  label: string;
}

function statusMessage(state: CopyState, label: string): string {
  if (state === "copied") return `${label} copied.`;
  if (state === "failed") {
    return `Couldn't copy the ${label}. Select it and copy it yourself.`;
  }

  return "";
}

export function CopyButton({ text, label }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  function copy() {
    window.navigator.clipboard.writeText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  }

  return (
    <>
      <Button variant="outline" onClick={copy}>
        {BUTTON_TEXT[state]}
        <span class="visually-hidden"> {label}</span>
      </Button>
      <span role="status" class="visually-hidden">
        {statusMessage(state, label)}
      </span>
    </>
  );
}
