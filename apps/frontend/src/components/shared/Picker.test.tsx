import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Picker, type PickerOption } from "./Picker.jsx";

const FRUITS = ["Apple", "Banana", "Blueberry", "Cherry", "Cranberry"];
const LONG_LIST_LENGTH = 40;
const FAR_DOWN = 30;

function optionsOf(names: string[]): PickerOption[] {
  return names.map((name) => ({ value: name, text: name, content: name }));
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockReset();
});

interface FruitPickerProps {
  names?: string[];
  initial?: string;
  onChange?: (value: string) => void;
}

function FruitPicker({
  names = FRUITS,
  initial = "Banana",
  onChange = () => undefined,
}: FruitPickerProps) {
  const [value, setValue] = useState(initial);

  return (
    <>
      <Picker
        label="Fruit"
        options={optionsOf(names)}
        value={value}
        onChange={(chosen) => {
          onChange(chosen);
          setValue(chosen);
        }}
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

function trigger() {
  return screen.getByRole("combobox", { name: "Fruit" });
}

function press(key: string) {
  fireEvent.keyDown(trigger(), { key });
  fireEvent.keyUp(trigger(), { key });
}

function activeOptionText() {
  const id = trigger().getAttribute("aria-activedescendant");
  if (id === null) throw new Error("No option is active");

  return document.getElementById(id)?.textContent;
}

function openWithKeyboard(props: FruitPickerProps = {}) {
  render(<FruitPicker {...props} />);
  trigger().focus();
  press("ArrowDown");
}

test("the trigger is a labelled combobox that controls a listbox", () => {
  render(<FruitPicker />);

  expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(trigger().textContent).toBe("Banana");
  expect(trigger().hasAttribute("aria-activedescendant")).toBe(false);
  expect(screen.queryByRole("listbox")).toBeNull();

  fireEvent.click(trigger());

  const list = screen.getByRole("listbox", { name: "Fruit" });
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(trigger().getAttribute("aria-controls")).toBe(list.id);
});

test("clicking the label moves focus to the trigger", () => {
  render(<FruitPicker />);
  fireEvent.click(screen.getByText("Fruit"));

  expect(document.activeElement).toBe(trigger());
});

test("the selected option is exposed and starts active", () => {
  openWithKeyboard();

  const selected = screen.getByRole("option", { selected: true });
  expect(selected.textContent).toBe("Banana");
  expect(activeOptionText()).toBe("Banana");
  expect(screen.getAllByRole("option", { selected: false })).toHaveLength(4);
});

test("Down and Up move the active option and stop at the ends", () => {
  openWithKeyboard();

  press("ArrowDown");
  expect(activeOptionText()).toBe("Blueberry");
  press("ArrowUp");
  press("ArrowUp");
  press("ArrowUp");
  expect(activeOptionText()).toBe("Apple");
});

test("Home and End go to the first and last option", () => {
  openWithKeyboard();

  press("End");
  expect(activeOptionText()).toBe("Cranberry");
  press("Home");
  expect(activeOptionText()).toBe("Apple");
});

test("Home opens the list on the first option", () => {
  render(<FruitPicker />);
  trigger().focus();
  press("Home");

  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(activeOptionText()).toBe("Apple");
});

test("typing moves to the option that starts with the typed text", () => {
  openWithKeyboard();

  press("c");
  expect(activeOptionText()).toBe("Cherry");
  press("r");
  expect(activeOptionText()).toBe("Cranberry");
});

test("typing the same letter again cycles through its options", () => {
  vi.useFakeTimers();
  openWithKeyboard();

  press("b");
  expect(activeOptionText()).toBe("Blueberry");
  vi.advanceTimersByTime(1_000);
  press("b");
  expect(activeOptionText()).toBe("Banana");
  vi.useRealTimers();
});

test("a longer search stays on the active option while it still matches", () => {
  openWithKeyboard({ names: ["Apple", "Crab", "Cranberry"], initial: "Apple" });

  press("c");
  expect(activeOptionText()).toBe("Crab");
  press("r");
  expect(activeOptionText()).toBe("Crab");
  press("a");
  press("n");
  expect(activeOptionText()).toBe("Cranberry");
});

test("repeating one letter cycles through the options it starts", () => {
  openWithKeyboard({ names: ["Apple", "Crab", "Cranberry"], initial: "Apple" });

  press("c");
  press("c");
  expect(activeOptionText()).toBe("Cranberry");
  press("c");
  expect(activeOptionText()).toBe("Crab");
});

test("Space acts on its release, so its press alone changes nothing", () => {
  render(<FruitPicker />);
  trigger().focus();

  const pressed = fireEvent.keyDown(trigger(), { key: " " });

  expect(pressed).toBe(false);
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.keyUp(trigger(), { key: " " });
  expect(screen.getByRole("listbox")).toBeTruthy();
});

test("typing on the closed picker opens it on the match", () => {
  render(<FruitPicker />);
  trigger().focus();
  press("c");

  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(activeOptionText()).toBe("Cherry");
});

test.each(["Enter", " "])(
  "%j selects the active option, closes and keeps focus on the trigger",
  (key) => {
    const onChange = vi.fn();
    openWithKeyboard({ onChange });

    press("ArrowDown");
    press(key);

    expect(onChange).toHaveBeenCalledWith("Blueberry");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger().textContent).toBe("Blueberry");
    expect(document.activeElement).toBe(trigger());
  },
);

test("choosing the option that is already selected changes nothing", () => {
  const onChange = vi.fn();
  openWithKeyboard({ onChange });
  press("Enter");

  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("Escape closes without choosing and keeps focus on the trigger", () => {
  const onChange = vi.fn();
  openWithKeyboard({ onChange });

  press("ArrowDown");
  press("Escape");

  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger());
});

test("Tab closes the list without choosing", () => {
  const onChange = vi.fn();
  openWithKeyboard({ onChange });

  press("ArrowDown");
  press("Tab");

  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

test("a pointer press outside closes the list", () => {
  openWithKeyboard();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));

  expect(screen.queryByRole("listbox")).toBeNull();
});

test("clicking an option chooses it and closes the list", () => {
  const onChange = vi.fn();
  render(<FruitPicker onChange={onChange} />);
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("option", { name: "Cherry" }));

  expect(onChange).toHaveBeenCalledWith("Cherry");
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("pressing on the list doesn't take focus from the trigger", () => {
  openWithKeyboard();
  const pressed = fireEvent.mouseDown(screen.getByRole("listbox"));

  expect(pressed).toBe(false);
});

test("a new choice is announced in a polite status region", () => {
  openWithKeyboard();
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("");

  press("ArrowDown");
  press("Enter");

  expect(status.textContent).toBe("Showing Blueberry");
  expect(document.activeElement).toBe(trigger());
});

test("renaming the selected option announces nothing", () => {
  const { rerender } = render(
    <Picker
      label="Fruit"
      options={optionsOf(FRUITS)}
      value="Banana"
      onChange={vi.fn()}
    />,
  );
  rerender(
    <Picker
      label="Fruit"
      options={[
        { value: "Banana", text: "Plantain", content: "Plantain" },
        ...optionsOf(["Cherry"]),
      ]}
      value="Banana"
      onChange={vi.fn()}
    />,
  );

  expect(trigger().textContent).toBe("Plantain");
  expect(screen.getByRole("status").textContent).toBe("");
});

function UnavailablePicker({ reason }: { reason?: string }) {
  return (
    <Picker
      label="Fruit"
      options={optionsOf(FRUITS)}
      value="Banana"
      unavailableReason={reason}
      onChange={vi.fn()}
    />
  );
}

test("an unavailable picker says why, keeps focus and ignores input", () => {
  render(<UnavailablePicker reason="Saving your changes." />);
  trigger().focus();

  fireEvent.click(trigger());
  press("ArrowDown");
  press(" ");
  press("c");

  expect(trigger().getAttribute("aria-disabled")).toBe("true");
  expect(
    document.getElementById(trigger().getAttribute("aria-describedby") ?? "")
      ?.textContent,
  ).toBe("Saving your changes.");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

test("a picker that becomes unavailable closes its list, then works again", () => {
  const { rerender } = render(<UnavailablePicker />);
  fireEvent.click(trigger());
  expect(screen.getByRole("listbox")).toBeTruthy();

  rerender(<UnavailablePicker reason="Saving your changes." />);
  expect(screen.queryByRole("listbox")).toBeNull();

  rerender(<UnavailablePicker />);
  expect(trigger().hasAttribute("aria-disabled")).toBe(false);
  expect(trigger().hasAttribute("aria-describedby")).toBe(false);
  fireEvent.click(trigger());
  expect(screen.getByRole("listbox")).toBeTruthy();
});

test("an unknown value is an error, not a quiet first option", () => {
  expect(() =>
    render(
      <Picker
        label="Fruit"
        options={optionsOf(FRUITS)}
        value="Durian"
        onChange={vi.fn()}
      />,
    ),
  ).toThrow('No option has the value "Durian"');
});

test("a long list scrolls the active option into view", () => {
  const names = Array.from(
    { length: LONG_LIST_LENGTH },
    (_, index) => `Fruit ${index}`,
  );
  openWithKeyboard({ names, initial: names[FAR_DOWN] });

  const options = screen.getAllByRole("option");
  const lastScrolled = () =>
    scrollIntoView.mock.contexts[scrollIntoView.mock.contexts.length - 1];
  expect(lastScrolled()).toBe(options[FAR_DOWN]);

  press("ArrowDown");
  expect(lastScrolled()).toBe(options[FAR_DOWN + 1]);
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
});
