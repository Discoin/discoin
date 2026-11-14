import { useId } from "preact/hooks";
import "./RadioGroup.scss";

export interface RadioOption<T extends string> {
  value: T;
  label: string;
}

interface RadioGroupProps<T extends string> {
  legend: string;
  options: RadioOption<T>[];
  value: T | undefined;
  error?: string;
  disabled: boolean;
  onChange: (value: T) => void;
}

export function RadioGroup<T extends string>({
  legend,
  options,
  value,
  error,
  disabled,
  onChange,
}: RadioGroupProps<T>) {
  const name = useId();
  const errorId = `${name}-error`;
  const invalid = error !== undefined;

  return (
    <fieldset
      class="radio-group"
      aria-describedby={invalid ? errorId : undefined}
      disabled={disabled}
    >
      <legend class="radio-group__legend">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} class="radio-group__option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            aria-invalid={invalid}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
      {invalid && (
        <p id={errorId} class="radio-group__error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
