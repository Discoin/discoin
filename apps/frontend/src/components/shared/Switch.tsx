import { useId } from "preact/hooks";
import "./Switch.scss";

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  const id = useId();

  return (
    <div class="switch">
      <input
        id={id}
        class="switch__input"
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <label class="switch__label" for={id}>
        {label}
      </label>
    </div>
  );
}
