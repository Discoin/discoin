import { renderHook } from "@testing-library/preact";
import { expect, test, vi } from "vitest";

import { installFakeMatchMedia } from "./fakeMatchMedia.js";
import { useMediaChange } from "./useMediaChange.js";

const QUERY = "(min-width: 60rem)";

test("the listener is added once and the newest callback receives changes", () => {
  const media = installFakeMatchMedia();
  const first = vi.fn();
  const second = vi.fn();
  const view = renderHook(({ onChange }) => useMediaChange(QUERY, onChange), {
    initialProps: { onChange: first },
  });

  view.rerender({ onChange: second });
  media.change(true);

  expect(media.additions()).toBe(1);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith(true);
});
