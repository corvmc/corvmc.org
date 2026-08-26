import { sqliteTable, text, integer, index, unique, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Roles & permissions (translated from spatie/laravel-permission)
// ---------------------------------------------------------------------------
//
// Only `roles` and `model_has_roles` are live: authorization in this app is
// role-name based (see src/lib/server/authorization.ts). `permissions`,
// `model_has_permissions` and `role_has_permissions` are **not read or written
// by any application code**. They hold the legacy Laravel grants, carried over
// by the Postgres ETL that has since been deleted — so whatever is in them now
// is all there will ever be, and there is no longer a Postgres to re-derive
// them from. Whether to keep or drop them is an open question nobody has taken:
// see docs/specs/admin-vs-staff-spec.md, which is where a real permission model
// would be decided. Do not build features on them without wiring up a real
// permission check first.

export const permission = sqliteTable(
	'permissions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		guardName: text('guard_name').notNull().default('web'),
		createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`)
	},
	(t) => [unique('permissions_name_guard_unique').on(t.name, t.guardName)]
);

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

export const modelHasPermission = sqliteTable(
	'model_has_permissions',
	{
		permissionId: integer('permission_id')
			.notNull()
			.references(() => permission.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.permissionId, t.userId] }),
		index('model_has_permissions_user_idx').on(t.userId)
	]
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

export const roleHasPermission = sqliteTable(
	'role_has_permissions',
	{
		permissionId: integer('permission_id')
			.notNull()
			.references(() => permission.id, { onDelete: 'cascade' }),
		roleId: integer('role_id')
			.notNull()
			.references(() => role.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.permissionId, t.roleId] })]
);
