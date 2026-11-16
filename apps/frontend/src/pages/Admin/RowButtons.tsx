import { Button } from "../../components/shared/Button.jsx";

interface RowButtonProps {
  subject: string;
  onClick: () => void;
}

export function EditButton({ subject, onClick }: RowButtonProps) {
  return (
    <Button variant="outline" onClick={onClick}>
      <span>
        <svg
          class="admin__pencil"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5z" />
        </svg>
        Edit
      </span>
      <span class="visually-hidden"> {subject}</span>
    </Button>
  );
}

export function RemoveButton({ subject, onClick }: RowButtonProps) {
  return (
    <Button variant="outline" onClick={onClick}>
      Remove
      <span class="visually-hidden"> {subject}</span>
    </Button>
  );
}
