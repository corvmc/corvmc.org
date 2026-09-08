import { sqliteTable, text, integer, index, unique, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Positions (originally translated from spatie/laravel-permission)
// ---------------------------------------------------------------------------
//
// `roles` and `model_has_roles` carry ASSIGNMENT — which people hold which
// position. That is the only part of authorization that changes at runtime, and
// the only part that belongs in a table.
//
// What a position may DO is not here. It is the capability matrix in
// src/lib/config.ts, checked by requireCapability() in
// src/lib/server/authorization.ts. See docs/specs/admin-vs-staff-spec.md.
//
// The three spatie permission tables that used to sit alongside these —
// `permissions`, `model_has_permissions`, `role_has_permissions` — were dropped
// once that matrix landed. They were read and written by nothing, held Laravel
// grants from a system that no longer exists, and were the roles-as-data model
// the spec declines: a mapping that lives only in a database is a mapping
// nobody reviews. Do not reintroduce them; add a capability to the matrix
// instead.

export const role = sqliteTable(
	'roles',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		guardName: text('guard_name').notNull().default('web'),
		createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
	},
	(t) => [unique('roles_name_guard_unique').on(t.name, t.guardName)]
);

export const modelHasRole = sqliteTable(
	'model_has_roles',
	{
		roleId: integer('role_id')
			.notNull()
			.references(() => role.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.roleId, t.userId] }),
		index('model_has_roles_user_idx').on(t.userId)
	]
);
