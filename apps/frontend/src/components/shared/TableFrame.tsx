import type { ComponentChildren } from "preact";
import "./DataTable.scss";

interface TableFrameProps {
  label: string;
  children: ComponentChildren;
}

export function TableFrame({ label, children }: TableFrameProps) {
  return (
    <div
      class="data-table-scroll"
      role="region"
      aria-label={`${label} table`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
