import { describe, expect, it } from 'vitest';
import { auditQuerySearch, parseAuditQuery, type AuditQuery } from './audit-query';

const parse = (search: string) => parseAuditQuery(new URLSearchParams(search));

describe('audit log query string', () => {
	it('reads back every filter it writes', () => {
		const q: AuditQuery = {
			search: 'Ellis & Park',
			action: 'user.roles_changed',
			subjectType: 'user',
			from: '2026-11-01',
			to: '2026-11-13',
			page: 3
		};
		expect(parse(auditQuerySearch(q))).toEqual(q);
	});

	it('leaves defaults out, so a clean view has a clean URL', () => {
		expect(auditQuerySearch(parse(''))).toBe('');
	});

	it('drops values the log cannot filter by', () => {
		expect(parse('action=nope&type=planet&from=yesterday&page=-2')).toEqual(parse(''));
	});
});
