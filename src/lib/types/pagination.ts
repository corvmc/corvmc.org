/**
 * Page metadata returned alongside any paginated list. Lives here rather than in
 * `server/db/schema/api.ts` so that `components/ui/` — which renders it — has no
 * reason to reach into the server tree. `schema/api.ts` re-exports it for the
 * services that were already importing it from there.
 */
export interface Pagination {
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
}
