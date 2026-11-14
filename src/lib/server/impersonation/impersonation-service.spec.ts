import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Viewing as a member (#2847), against real SQLite: the admin check reads the
 * role tables, and the audit rows are what a later reader relies on.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const requestEvent = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		if (!requestEvent.current) throw new Error('outside a request');
		return requestEvent.current;
	}
}));

const { assertMayImpersonate, ImpersonationRefusedError, recordImpersonation } =
	await import('./impersonation-service');
const { auditImpersonatedRequest, couldWrite, refusedWhileImpersonating } =
	await import('./impersonation-request');
const { recordAuditEntry } = await import('#lib/server/audit/audit-service.js');
const { impersonatorId } = await import('./impersonation-guard');

const ADMIN = { id: 'u-admin', name: 'Ada Admin', email: 'ada@example.com' };

function grant(userId: string, position: string) {
	sqlite.exec(`insert or ignore into roles (name, guard_name) values ('${position}', 'web')`);
	sqlite.exec(
		`insert into model_has_roles (role_id, user_id) select id, '${userId}' from roles where name = '${position}'`
	);
}

function auditRows() {
	return sqlite
		.prepare(
			`select action, actor_user_id as actor, subject_type as subjectType, subject_id as subject, details
			 from audit_log order by rowid`
		)
		.all() as {
		action: string;
		actor: string;
		subjectType: string;
		subject: string;
		details: string;
	}[];
}

function viewing(method: string, pathname = '/_app/remote/abc/updateProfile') {
	requestEvent.current = {
		request: new Request(`https://corvmc.org${pathname}`, { method }),
		url: new URL(`https://corvmc.org${pathname}`),
		locals: {
			user: { id: 'u-member', name: 'Max Member', email: 'max@example.com' },
			session: { impersonatedBy: 'u-admin' },
			impersonator: ADMIN
		}
	};
	return requestEvent.current as Parameters<typeof auditImpersonatedRequest>[0];
}

beforeEach(() => {
	requestEvent.current = null;
	sqlite.exec('delete from audit_log; delete from model_has_roles; delete from user;');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values
			('u-admin', 'Ada Admin', 'ada@example.com', 1),
			('u-admin-2', 'Abe Admin', 'abe@example.com', 1),
			('u-staff', 'Sal Staff', 'sal@example.com', 1),
			('u-member', 'Max Member', 'max@example.com', 1)`
	);
	grant('u-admin', 'admin');
	grant('u-admin-2', 'admin');
	grant('u-staff', 'staff');
});

describe('who may view as a member', () => {
	it('lets an admin view as a member', async () => {
		await expect(assertMayImpersonate('u-admin', 'u-member')).resolves.toBeUndefined();
	});

	it('refuses anyone who does not hold the admin role, staff included', async () => {
		for (const viewer of ['u-staff', 'u-member']) {
			await expect(assertMayImpersonate(viewer, 'u-member')).rejects.toBeInstanceOf(
				ImpersonationRefusedError
			);
		}
	});

	it('never views as an admin, even for another admin', async () => {
		await expect(assertMayImpersonate('u-admin', 'u-admin-2')).rejects.toBeInstanceOf(
			ImpersonationRefusedError
		);
		await expect(assertMayImpersonate('u-admin', 'u-admin')).rejects.toBeInstanceOf(
			ImpersonationRefusedError
		);
	});

	it('refuses a closed account', async () => {
		sqlite.exec(`update user set deleted_at = unixepoch() where id = 'u-member'`);
		await expect(assertMayImpersonate('u-admin', 'u-member')).rejects.toBeInstanceOf(
			ImpersonationRefusedError
		);
	});
});

describe('the audit', () => {
	it('records start and stop with the admin as actor and the member as subject', async () => {
		await recordImpersonation('started', ADMIN, 'u-member');
		await recordImpersonation('stopped', ADMIN, 'u-member');
		expect(auditRows().map(({ details: _d, ...r }) => r)).toEqual([
			{
				action: 'user.impersonation_started',
				actor: 'u-admin',
				subjectType: 'user',
				subject: 'u-member'
			},
			{
				action: 'user.impersonation_stopped',
				actor: 'u-admin',
				subjectType: 'user',
				subject: 'u-member'
			}
		]);
	});

	it('records every request that could write, under the admin', async () => {
		await auditImpersonatedRequest(viewing('POST'), 200);
		await auditImpersonatedRequest(viewing('GET'), 200);
		const rows = auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			action: 'user.impersonated_write',
			actor: 'u-admin',
			subject: 'u-member'
		});
		expect(JSON.parse(rows[0].details)).toEqual({
			method: 'POST',
			path: '/_app/remote/abc/updateProfile',
			status: 200
		});
	});

	it('names the admin, not the member, on any other entry written meanwhile', async () => {
		viewing('POST');
		await recordAuditEntry({
			action: 'user.profile_updated',
			subject: { type: 'user', id: 'u-member', label: 'Max Member' },
			details: { fields: ['name'] }
		} as Parameters<typeof recordAuditEntry>[0]);
		expect(auditRows()[0]).toMatchObject({ actor: 'u-admin', subject: 'u-member' });
	});

	it('writes nothing for a request that is not viewing as anyone', async () => {
		const event = viewing('POST');
		event.locals.impersonator = undefined;
		await auditImpersonatedRequest(event, 200);
		expect(auditRows()).toEqual([]);
	});
});

describe('what is refused', () => {
	it("refuses better-auth's credential endpoints and leaves the rest", () => {
		expect(refusedWhileImpersonating('/api/auth/change-password')).toBe(true);
		expect(refusedWhileImpersonating('/api/auth/change-email')).toBe(true);
		expect(refusedWhileImpersonating('/api/auth/get-session')).toBe(false);
		expect(couldWrite('post')).toBe(true);
		expect(couldWrite('GET')).toBe(false);
	});

	it('knows the admin only inside an impersonated request', () => {
		expect(impersonatorId()).toBeNull();
		viewing('GET');
		expect(impersonatorId()).toBe('u-admin');
	});
});
