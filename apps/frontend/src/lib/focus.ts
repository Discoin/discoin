export function focusFirstInput(container: HTMLElement | null): void {
  const input = container?.querySelector("input");
  if (input === null || input === undefined) {
    throw new Error("No input to move focus to");
  }

  input.focus();
}
