import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Button } from "./Button.jsx";
import { CopyButton } from "./CopyButton.jsx";
import "./SecretField.scss";

const MASK = "•".repeat(24);

interface SecretFieldProps {
  label: string;
  secret: string;
  children?: ComponentChildren;
}

export function SecretField({ label, secret, children }: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div class="secret-field">
      <span class="secret-field__label">{label}</span>
      <div class="secret-field__row">
        <code class="secret-field__value figure">
          {revealed ? (
            secret
          ) : (
            <>
              <span aria-hidden="true">{MASK}</span>
              <span class="visually-hidden">Hidden</span>
            </>
          )}
        </code>
        <Button variant="outline" onClick={() => setRevealed(!revealed)}>
          {revealed ? "Hide" : "Show"}
          <span class="visually-hidden"> {label}</span>
        </Button>
        <CopyButton text={secret} label={label} />
      </div>
      {children}
    </div>
  );
}
