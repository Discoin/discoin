import type { ActionState } from "../../lib/useAction.js";
import "./ActionStatus.scss";

interface ActionStatusProps {
  state: ActionState;
  inlineFields: string[];
}

function isShownInline(state: ActionState, inlineFields: string[]): boolean {
  if (state.status !== "failed" || state.error.field === undefined) {
    return false;
  }

  return inlineFields.includes(state.error.field);
}

function messageOf(state: ActionState): string {
  if (state.status === "failed") return state.error.message;

  return "";
}

export function ActionStatus({ state, inlineFields }: ActionStatusProps) {
  const classes = ["action-status"];
  if (state.status === "failed") classes.push("action-status--failed");
  if (isShownInline(state, inlineFields)) classes.push("visually-hidden");

  return (
    <p class={classes.join(" ")} role="status">
      {messageOf(state)}
    </p>
  );
}
