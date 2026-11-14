import { auditActions, auditSubjectTypes } from '#lib/types/audit.js';
import type { AuditAction, AuditSubjectType } from '#lib/types/audit.js';

/** The audit log's filters, as `/staff/system/audit` keeps them in its query string (#2826). */
export interface AuditQuery {
	search: string;
	action: AuditAction | '';
	subjectType: AuditSubjectType | '';
	from: string;
	to: string;
	page: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(values: readonly T[], raw: string | null): T | '' {
	return values.includes(raw as T) ? (raw as T) : '';
}

/** The query string is user input: a value the log cannot filter by drops out. */
export function parseAuditQuery(params: Pick<URLSearchParams, 'get'>): AuditQuery {
	const day = (raw: string | null) => (raw && DAY.test(raw) ? raw : '');
	const page = Number(params.get('page'));
	return {
		search: (params.get('q') ?? '').slice(0, 200),
		action: pick(auditActions, params.get('action')),
		subjectType: pick(auditSubjectTypes, params.get('type')),
		from: day(params.get('from')),
		to: day(params.get('to')),
		page: Number.isInteger(page) && page > 1 ? page : 1
	};
}

/** The filters as a search string, defaults left out. */
export function auditQuerySearch(q: AuditQuery): string {
	const pairs: [string, string][] = [];
	if (q.search) pairs.push(['q', q.search]);
	if (q.action) pairs.push(['action', q.action]);
	if (q.subjectType) pairs.push(['type', q.subjectType]);
	if (q.from) pairs.push(['from', q.from]);
	if (q.to) pairs.push(['to', q.to]);
	if (q.page > 1) pairs.push(['page', String(q.page)]);
	return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
