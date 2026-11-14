import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { TOAST_DURATION_MS, ToastQueue, type Toast } from "./toasts.js";

const HALF = TOAST_DURATION_MS / 2;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function watch(queue: ToastQueue): () => string[] {
  let latest: Toast[] = [];
  queue.subscribe((toasts) => {
    latest = toasts;
  });

  return () => latest.map((toast) => toast.message);
}

test("toasts stack in the order they were shown", () => {
  const queue = new ToastQueue();
  const messages = watch(queue);
  queue.show("Saved OAT.");
  queue.show("Blocked 700000000000000001 everywhere.");

  expect(messages()).toEqual([
    "Saved OAT.",
    "Blocked 700000000000000001 everywhere.",
  ]);
});

test("a toast closes once its time is up", () => {
  const queue = new ToastQueue();
  const messages = watch(queue);
  queue.show("Saved OAT.");

  vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
  expect(messages()).toEqual(["Saved OAT."]);

  vi.advanceTimersByTime(1);
  expect(messages()).toEqual([]);
});

test("a held toast stays, then gets only its remaining time", () => {
  const queue = new ToastQueue();
  const messages = watch(queue);
  queue.show("Saved OAT.");
  vi.advanceTimersByTime(HALF);

  queue.hold(1);
  vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
  expect(messages()).toEqual(["Saved OAT."]);

  queue.release(1);
  vi.advanceTimersByTime(HALF - 1);
  expect(messages()).toEqual(["Saved OAT."]);

  vi.advanceTimersByTime(1);
  expect(messages()).toEqual([]);
});

test("hover and focus together keep a toast until both end", () => {
  const queue = new ToastQueue();
  const messages = watch(queue);
  queue.show("Saved OAT.");
  queue.hold(1);
  queue.hold(1);

  queue.release(1);
  vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
  expect(messages()).toEqual(["Saved OAT."]);

  queue.release(1);
  vi.advanceTimersByTime(TOAST_DURATION_MS);
  expect(messages()).toEqual([]);
});

test("closing one toast leaves the others and their timers", () => {
  const queue = new ToastQueue();
  const messages = watch(queue);
  queue.show("Saved OAT.");
  queue.show("Added Shells (SHL).");

  queue.dismiss(1);
  expect(messages()).toEqual(["Added Shells (SHL)."]);

  vi.advanceTimersByTime(TOAST_DURATION_MS);
  expect(messages()).toEqual([]);
});

test("pointer and focus events after a toast closes change nothing", () => {
  const queue = new ToastQueue();
  const messages = watch(queue);
  queue.show("Saved OAT.");
  queue.dismiss(1);

  queue.release(1);
  queue.hold(1);
  queue.dismiss(1);

  expect(messages()).toEqual([]);
});
