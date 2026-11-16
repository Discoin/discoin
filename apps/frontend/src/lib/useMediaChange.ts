import { useLayoutEffect, useRef } from "preact/hooks";

export function useMediaChange(
  query: string,
  onChange: (matches: boolean) => void,
): void {
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  useLayoutEffect(() => {
    const media = window.matchMedia(query);

    function report(event: MediaQueryListEvent) {
      latestOnChange.current(event.matches);
    }

    media.addEventListener("change", report);

    return () => media.removeEventListener("change", report);
  }, [query]);
}
