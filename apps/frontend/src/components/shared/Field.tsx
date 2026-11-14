import type { ComponentProps } from "preact";
import { useId } from "preact/hooks";
import "./Field.scss";

type FieldProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
};

export function Field({ label, hint, error, suffix, ...input }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div class={error === undefined ? "field" : "field field--invalid"}>
      <label class="field__label" for={id}>
        {label}
      </label>
      <div class="field__control">
        <input
          id={id}
          class="field__input"
          aria-invalid={error !== undefined}
          aria-describedby={message === undefined ? undefined : messageId}
          {...input}
        />
        {suffix && <span class="field__suffix figure">{suffix}</span>}
      </div>
      {message && (
        <p id={messageId} class="field__message">
          {message}
        </p>
      )}
    </div>
  );
}
