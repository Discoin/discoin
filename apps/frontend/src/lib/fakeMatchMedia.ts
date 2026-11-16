type ChangeListener = (event: MediaQueryListEvent) => void;

export interface FakeMedia {
  change: (matches: boolean) => void;
  additions: () => number;
}

export function installFakeMatchMedia(): FakeMedia {
  const listeners = new Set<ChangeListener>();
  let additions = 0;

  window.matchMedia = (query: string) =>
    ({
      media: query,
      addEventListener: (_type: string, listener: ChangeListener) => {
        additions += 1;
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: ChangeListener) =>
        listeners.delete(listener),
    }) as unknown as MediaQueryList;

  return {
    additions: () => additions,
    change: (matches) => {
      for (const listener of [...listeners]) {
        listener({ matches } as MediaQueryListEvent);
      }
    },
  };
}
