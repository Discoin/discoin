const MAIN_ID = "main";

function focusIsLost(): boolean {
  return (
    document.activeElement === null || document.activeElement === document.body
  );
}

export function focusMainWhenFocusIsLost(): void {
  if (!focusIsLost()) return;

  const main = document.getElementById(MAIN_ID);
  if (main === null) {
    throw new Error(`Missing main element with id "${MAIN_ID}"`);
  }

  main.focus({ preventScroll: true });
}

export function focusFirstInput(container: HTMLElement | null): void {
  const input = container?.querySelector("input");
  if (input === null || input === undefined) {
    throw new Error("No input to move focus to");
  }

  input.focus();
}
