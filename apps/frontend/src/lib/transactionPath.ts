export function transactionPath(id: string): string {
  return `/transactions/${encodeURIComponent(id)}`;
}
