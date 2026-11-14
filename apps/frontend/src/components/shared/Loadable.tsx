import type { ComponentChildren } from "preact";
import type { RequestState } from "../../lib/useRequest.js";
import { Button } from "./Button.jsx";
import { EmptyState } from "./EmptyState.jsx";
import { Notice } from "./Notice.jsx";
import "./Loadable.scss";

interface EmptyView<T> {
  when: (data: T) => boolean;
  title: string;
  body: ComponentChildren;
}

interface LoadableProps<T> {
  state: RequestState<T>;
  label: string;
  onRetry: () => void;
  empty?: EmptyView<T>;
  children: (data: T) => ComponentChildren;
}

export function Loadable<T>({
  state,
  label,
  onRetry,
  empty,
  children,
}: LoadableProps<T>) {
  if (state.status === "loading") {
    return (
      <p class="loadable__loading" role="status">
        Loading {label}
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <Notice tone="error" title={`Couldn't load ${label}`}>
        <p>{state.error.message}</p>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </Notice>
    );
  }

  if (empty?.when(state.data)) {
    return <EmptyState title={empty.title}>{empty.body}</EmptyState>;
  }

  return <>{children(state.data)}</>;
}
