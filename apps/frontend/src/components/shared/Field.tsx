import type { ComponentProps, JSX } from "preact";
import { useId } from "preact/hooks";
import "./Field.scss";

export interface FieldText {
  hint?: string;
  error?: string;
}

interface DescribedField {
  className: string;
  control: { "aria-invalid": boolean; "aria-describedby": string | undefined };
  message: JSX.Element | undefined;
}

export function describedField(id: string, text: FieldText): DescribedField {
  const messageId = `${id}-message`;
  const message = text.error ?? text.hint;

  return {
    className: text.error === undefined ? "field" : "field field--invalid",
    control: {
      "aria-invalid": text.error !== undefined,
      "aria-describedby": message === undefined ? undefined : messageId,
    },
    message:
      message === undefined ? undefined : (
        <p id={messageId} class="field__message">
          {message}
        </p>
      ),
  };
}

type FieldProps = ComponentProps<"input"> &
  FieldText & {
    label: string;
    suffix?: string;
  };

export function Field({ label, hint, error, suffix, ...input }: FieldProps) {
  const id = useId();
  const described = describedField(id, { hint, error });

  return (
    <div class={described.className}>
      <label class="field__label" for={id}>
        {label}
      </label>
      <div class="field__control">
        <input id={id} class="field__input" {...described.control} {...input} />
        {suffix && <span class="field__suffix figure">{suffix}</span>}
      </div>
      {described.message}
    </div>
  );
}
