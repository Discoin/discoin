export function currencyPath(abbreviation: string): string {
  return `/currency/${encodeURIComponent(abbreviation)}`;
}
