import { Button } from "../../components/shared/Button.jsx";
import { Dialog } from "../../components/shared/Dialog.jsx";
import "../../components/layout/Panel.scss";
import "./SwitchConfirm.scss";

interface SwitchConfirmProps {
  target: string;
  unsavedForms: string[];
  onStay: () => void;
  onSwitch: () => void;
}

export function SwitchConfirm({
  target,
  unsavedForms,
  onStay,
  onSwitch,
}: SwitchConfirmProps) {
  return (
    <Dialog title="Discard unsaved changes?" onClose={onStay}>
      <div class="form-stack">
        <p>These changes aren't saved yet:</p>
        <ul class="switch-confirm__forms">
          {unsavedForms.map((form) => (
            <li key={form}>{form}</li>
          ))}
        </ul>
        <p>Switching to {target} discards them.</p>
        <div class="form-actions">
          <Button variant="outline" onClick={onStay}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={onSwitch}>
            Switch to {target}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
