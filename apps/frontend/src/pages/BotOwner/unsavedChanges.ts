import { createContext } from "preact";
import { useContext, useLayoutEffect } from "preact/hooks";

export interface FormStatus {
  hasChanges: boolean;
  isSaving: boolean;
}

export interface UnsavedChanges {
  report: (form: string, status: FormStatus) => void;
  forget: (form: string) => void;
  forms: () => string[];
}

export function createUnsavedChanges(
  onSavingChange: (isSaving: boolean) => void,
): UnsavedChanges {
  const statuses = new Map<string, FormStatus>();

  function formsWhere(test: (status: FormStatus) => boolean): string[] {
    return [...statuses]
      .filter(([, status]) => test(status))
      .map(([form]) => form);
  }

  function announceSaving() {
    onSavingChange(formsWhere((status) => status.isSaving).length > 0);
  }

  return {
    report: (form, status) => {
      statuses.set(form, status);
      announceSaving();
    },
    forget: (form) => {
      statuses.delete(form);
      announceSaving();
    },
    forms: () => formsWhere((status) => status.hasChanges),
  };
}

export const UnsavedChangesContext = createContext<UnsavedChanges | null>(null);

export function useUnsavedChanges(form: string, status: FormStatus): void {
  const tracker = useContext(UnsavedChangesContext);
  if (tracker === null) {
    throw new Error(`The ${form} form isn't inside an UnsavedChangesContext`);
  }

  useLayoutEffect(() => {
    tracker.report(form, status);
  }, [status.hasChanges, status.isSaving]);

  useLayoutEffect(() => () => tracker.forget(form), []);
}
