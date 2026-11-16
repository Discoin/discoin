import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { useDisclosure, usePopupDismissal } from "./Disclosure.jsx";
import "./Picker.scss";

const TYPEAHEAD_RESET_MS = 500;

export interface PickerOption {
  value: string;
  text: string;
  content: ComponentChildren;
}

interface PickerProps {
  label: string;
  options: PickerOption[];
  value: string;
  unavailableReason?: string;
  onChange: (value: string) => void;
}

function indexOfValue(options: PickerOption[], value: string): number {
  const index = options.findIndex((option) => option.value === value);
  if (index === -1) throw new Error(`No option has the value "${value}"`);

  return index;
}

function isCharacter(event: KeyboardEvent): boolean {
  const modified = event.ctrlKey || event.metaKey || event.altKey;

  return event.key.length === 1 && event.key !== " " && !modified;
}

function matchingIndex(
  texts: string[],
  search: string,
  current: number,
): number {
  const oneLetterRepeated = [...search].every((letter) => letter === search[0]);
  const from = oneLetterRepeated ? current + 1 : current;
  const ordered = texts.map((_, offset) => (from + offset) % texts.length);
  const startingWith = (prefix: string) =>
    ordered.find((index) => texts[index].toLowerCase().startsWith(prefix));
  const match =
    startingWith(search) ??
    (oneLetterRepeated ? startingWith(search[0]) : undefined);

  return match ?? -1;
}

function useTypeahead(texts: string[]) {
  const search = useRef("");
  const resetTimer = useRef<number | undefined>(undefined);

  return function indexAfterTyping(character: string, current: number) {
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      search.current = "";
    }, TYPEAHEAD_RESET_MS);
    search.current += character.toLowerCase();

    return matchingIndex(texts, search.current, current);
  };
}

function useChangeAnnouncement(value: string, text: string): string {
  const [message, setMessage] = useState("");
  const announcedValue = useRef(value);

  useEffect(() => {
    if (announcedValue.current === value) return;

    announcedValue.current = value;
    setMessage(`Showing ${text}`);
  }, [value]);

  return message;
}

export function Picker({
  label,
  options,
  value,
  unavailableReason,
  onChange,
}: PickerProps) {
  const disclosure = useDisclosure<HTMLDivElement>();
  const popup = usePopupDismissal(disclosure);
  const labelId = useId();
  const reasonId = useId();
  const isAvailable = unavailableReason === undefined;
  const listRef = useRef<HTMLUListElement>(null);
  const selectedIndex = indexOfValue(options, value);
  const lastIndex = options.length - 1;
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const indexAfterTyping = useTypeahead(options.map((option) => option.text));
  const announcement = useChangeAnnouncement(
    value,
    options[selectedIndex].text,
  );

  useEffect(() => {
    if (!disclosure.isOpen) return;

    const option = listRef.current?.children.item(activeIndex);
    if (option === null || option === undefined) {
      throw new Error("The active option didn't render");
    }

    option.scrollIntoView({ block: "nearest" });
  }, [disclosure.isOpen, activeIndex]);

  useEffect(() => {
    if (!isAvailable) disclosure.close();
  }, [isAvailable]);

  function optionId(index: number): string {
    return `${disclosure.panelId}-option-${index}`;
  }

  function focusTrigger() {
    const trigger = disclosure.triggerRef.current;
    if (trigger === null) throw new Error("The picker trigger didn't render");

    trigger.focus();
  }

  function openAt(index: number) {
    setActiveIndex(index);
    disclosure.open();
  }

  function select(index: number) {
    disclosure.close();
    const chosen = options[index].value;
    if (chosen !== value) onChange(chosen);
  }

  function toggleList() {
    if (!isAvailable) return;

    if (disclosure.isOpen) disclosure.close();
    else openAt(selectedIndex);
  }

  function chooseOrOpen() {
    if (disclosure.isOpen) select(activeIndex);
    else openAt(selectedIndex);
  }

  function typeCharacter(character: string) {
    const current = disclosure.isOpen ? activeIndex : selectedIndex;
    const match = indexAfterTyping(character, current);
    if (match !== -1) openAt(match);
  }

  function closedKeyActions(): Record<string, () => void> {
    const openSelected = () => openAt(selectedIndex);

    return {
      ArrowDown: openSelected,
      ArrowUp: openSelected,
      Enter: openSelected,
      Home: () => openAt(0),
      End: () => openAt(lastIndex),
    };
  }

  function openKeyActions(): Record<string, () => void> {
    return {
      ArrowDown: () => setActiveIndex(Math.min(activeIndex + 1, lastIndex)),
      ArrowUp: () => setActiveIndex(Math.max(activeIndex - 1, 0)),
      Home: () => setActiveIndex(0),
      End: () => setActiveIndex(lastIndex),
      Enter: () => select(activeIndex),
    };
  }

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "Tab") {
      disclosure.close();

      return;
    }

    if (!isAvailable) return;

    if (event.key === " ") {
      event.preventDefault();

      return;
    }

    if (isCharacter(event)) {
      event.preventDefault();
      typeCharacter(event.key);

      return;
    }

    const actions = disclosure.isOpen ? openKeyActions() : closedKeyActions();
    const action = actions[event.key];
    if (action === undefined) return;

    event.preventDefault();
    action();
  }

  function onTriggerKeyUp(event: KeyboardEvent) {
    if (event.key === " " && isAvailable) chooseOrOpen();
  }

  return (
    <div ref={popup.rootRef} class="picker" onKeyDown={popup.closeOnEscape}>
      <span id={labelId} class="picker__label" onClick={focusTrigger}>
        {label}
      </span>
      <div
        ref={disclosure.triggerRef}
        role="combobox"
        tabIndex={0}
        class="picker__trigger"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={disclosure.isOpen}
        aria-controls={disclosure.panelId}
        aria-activedescendant={
          disclosure.isOpen ? optionId(activeIndex) : undefined
        }
        aria-disabled={isAvailable ? undefined : "true"}
        aria-describedby={isAvailable ? undefined : reasonId}
        onClick={toggleList}
        onKeyDown={onTriggerKeyDown}
        onKeyUp={onTriggerKeyUp}
      >
        <span class="picker__value">{options[selectedIndex].content}</span>
        <svg
          class="picker__chevron"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path d="M4 6l4 4l4-4" />
        </svg>
      </div>
      {disclosure.isOpen && (
        <ul
          ref={listRef}
          id={disclosure.panelId}
          role="listbox"
          class="picker__list"
          aria-labelledby={labelId}
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              class={
                index === activeIndex
                  ? "picker__option picker__option--active"
                  : "picker__option"
              }
              aria-selected={index === selectedIndex}
              onClick={() => select(index)}
            >
              <svg
                class="picker__check"
                viewBox="0 0 16 16"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path d="M3 8.5l3 3l7-7" />
              </svg>
              <span class="picker__option-content">{option.content}</span>
            </li>
          ))}
        </ul>
      )}
      {!isAvailable && (
        <p id={reasonId} class="visually-hidden">
          {unavailableReason}
        </p>
      )}
      <p class="visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  );
}
