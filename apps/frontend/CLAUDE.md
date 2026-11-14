# Frontend

Preact app built with Vite. Run its tasks through nx from the repo root, for example `npx nx run frontend:e2e`.

## Folder layout

- `src/components/shared/`: generic UI with no Discoin domain knowledge, such as buttons, fields, dialogs, tables, notices and toasts.
- `src/components/layout/`: the page frame, such as the header, ticker, wordmark, page intro and panel.
- `src/components/<feature>/`: domain components used by more than one page, grouped by feature (`currency`, `transactions`, `blocking`).
- `src/pages/<Page>/`: each page's `index.tsx`, plus components that only that page uses.
- Keep a component's `.tsx`, `.scss` and `.test.tsx` side by side. Import files directly; there are no barrel `index.ts` files.

Where a new component goes: generic UI with no Discoin knowledge always goes in `shared`. A domain component used by only one page goes in that page's folder; one used by several pages goes in the matching feature folder. Count a component as used by every page that uses its parent component.

## Styling

- Every color comes from a token in `src/styles/_tokens.scss`. Don't write literal colors in components. Each token has a light value and a dark value.
- Format numbers with the helpers in `src/lib/format.ts` so each kind of number looks the same everywhere.

## Accessibility

The frontend must meet WCAG 2.2 AA.

- `e2e/accessibility.spec.ts` runs axe on every page in light and dark. Add each new route to its `PAGES` list.
- Text needs 4.5:1 contrast against its background, and control borders and other meaningful graphics need 3:1. Check both themes, including the sunken surface.
- Clickable targets are at least 24 by 24 px.
- Anything that moves on its own has a pause control and respects `prefers-reduced-motion`.
- Every page sets its title with `usePageTitle`.
- Color never carries meaning alone. Price moves pair green or red with ▲ or ▼.
