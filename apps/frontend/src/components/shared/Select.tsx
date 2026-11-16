import type { ComponentProps } from "preact";
import { useId } from "preact/hooks";
import { describedField, type FieldText } from "./Field.jsx";
import "./Field.scss";

type SelectProps = ComponentProps<"select"> &
  FieldText & {
    label: string;
  };

export function Select({
  label,
  hint,
  error,
  children,
  ...select
}: SelectProps) {
  const id = useId();
  const described = describedField(id, { hint, error });

  return (
    <div class={described.className}>
      <label class="field__label" for={id}>
        {label}
      </label>
      <div class="field__control">
        <select
          id={id}
          class="field__input field__select"
          {...described.control}
          {...select}
        >
          {children}
        </select>
      </div>
      {described.message}
    </div>
  );
}
