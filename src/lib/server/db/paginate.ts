import type { Pagination } from '$lib/server/db/schema/api';
import type { SQLiteSelect } from 'drizzle-orm/sqlite-core';

export interface PaginationInput {
	page?: number;
	pageSize?: number;
}

export interface PaginatedResult<T> {
	rows: T[];
	pagination: Pagination;
}

export async function paginate<T extends SQLiteSelect>(
	dataQuery: T,
	countQuery: Promise<{ count: number }[]>,
	{ page = 1, pageSize = 50 }: PaginationInput = {}
): Promise<PaginatedResult<Awaited<T>[number]>> {
	const offset = (page - 1) * pageSize;

	const [rows, [countRow]] = await Promise.all([
		dataQuery.limit(pageSize).offset(offset),
		countQuery
	]);

	const total = countRow?.count ?? 0;
	return {
		rows: rows as Awaited<T>[number][],
		pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
	};
}
