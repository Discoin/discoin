import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

export function useFocusAfterClose(target: RefObject<HTMLElement>): () => void {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting) return;

    const element = target.current;
    if (element === null) throw new Error("Nothing to move focus to");

    element.focus();
    setWaiting(false);
  }, [waiting]);

  return () => setWaiting(true);
}
