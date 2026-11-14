import { useEffect, useRef, useState } from "preact/hooks";

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      throw new Error("useElementWidth needs its ref on a rendered element");
    }

    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
