import { db } from '$lib/server/db';
import { funder, grantApplication, type Funder, type NewFunder } from '$lib/server/db/schema/grant';
import { asc, count, eq, isNull } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';

export class FunderNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Funder not found');
	}
}

export class FunderInUseError extends DomainError {
	readonly httpStatus = 409;
	constructor(n: number) {
		super(
			`${n} ${n === 1 ? 'application names' : 'applications name'} this funder. Archive it instead.`
		);
	}
}

/** Live funders (or all, with the archived filter on), each with its application count. */
export async function listFunders({ includeArchived = false }: { includeArchived?: boolean } = {}) {
	const [funders, apps] = await Promise.all([
		db
			.select()
			.from(funder)
			.where(includeArchived ? undefined : isNull(funder.deletedAt))
			.orderBy(asc(funder.name)),
		db.select({ funderId: grantApplication.funderId }).from(grantApplication)
	]);
	return funders.map((f) => ({
		...f,
		applications: apps.filter((a) => a.funderId === f.id).length
	}));
}

export type FunderInput = Omit<NewFunder, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export async function createFunder(input: FunderInput): Promise<Funder> {
	const [row] = await db.insert(funder).values(input).returning();
	return row;
}

export async function updateFunder(id: string, input: FunderInput): Promise<void> {
	const rows = await db
		.update(funder)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(funder.id, id))
		.returning({ id: funder.id });
	if (rows.length === 0) throw new FunderNotFoundError();
}

async function setFunderArchived(id: string, deletedAt: Date | null): Promise<void> {
	const rows = await db
		.update(funder)
		.set({ deletedAt, updatedAt: new Date() })
		.where(eq(funder.id, id))
		.returning({ id: funder.id });
	if (rows.length === 0) throw new FunderNotFoundError();
}

/** Off the active list and the application picker; every application stays. */
export function archiveFunder(id: string): Promise<void> {
	return setFunderArchived(id, new Date());
}

export function restoreFunder(id: string): Promise<void> {
	return setFunderArchived(id, null);
}

/** Only for a row that should never have existed. Refused once an application names it. */
export async function deleteFunder(id: string): Promise<void> {
	const [used] = await db
		.select({ n: count() })
		.from(grantApplication)
		.where(eq(grantApplication.funderId, id));
	const n = Number(used?.n ?? 0);
	if (n > 0) throw new FunderInUseError(n);

	const rows = await db.delete(funder).where(eq(funder.id, id)).returning({ id: funder.id });
	if (rows.length === 0) throw new FunderNotFoundError();
}
