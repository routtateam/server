export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function parsePagination(query: Record<string, unknown>, defaults = { page: 1, pageSize: 20 }) {
  const page = Math.max(1, Number(query.page) || defaults.page);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || defaults.pageSize));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}
