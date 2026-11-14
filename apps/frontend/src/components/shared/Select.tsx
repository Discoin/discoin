import type { ComponentProps } from "preact";
import { useId } from "preact/hooks";
import "./Field.scss";

type SelectProps = ComponentProps<"select"> & {
  label: string;
};

export function Select({ label, children, ...select }: SelectProps) {
  const id = useId();

  return (
    <div class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      <div class="field__control">
        <select id={id} class="field__input field__select" {...select}>
          {children}
        </select>
      </div>
    </div>
  );
}
