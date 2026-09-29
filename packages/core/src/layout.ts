export interface GridLayout {
  cols: number;
  rows: number;
  /** Cards shown per page; more live matches than this rotate through pages. */
  pageSize: number;
}

/** Live dashboard grid for a number of concurrent matches. */
export function gridFor(count: number): GridLayout {
  if (count <= 1) return { cols: 1, rows: 1, pageSize: 1 };
  if (count === 2) return { cols: 2, rows: 1, pageSize: 2 };
  if (count <= 4) return { cols: 2, rows: 2, pageSize: 4 };
  if (count <= 6) return { cols: 3, rows: 2, pageSize: 6 };
  return { cols: 3, rows: 3, pageSize: 9 };
}

export function paginate<T>(items: T[], pageSize: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) pages.push(items.slice(i, i + pageSize));
  return pages.length ? pages : [[]];
}
