import { useEffect } from "preact/hooks";

const SITE_NAME = "Discoin";

export function pageTitle(page: string | undefined): string {
  return page === undefined ? SITE_NAME : `${page} | ${SITE_NAME}`;
}

export function usePageTitle(page: string | undefined): void {
  useEffect(() => {
    document.title = pageTitle(page);
  }, [page]);
}
