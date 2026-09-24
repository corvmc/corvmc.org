import { db } from '$lib/server/db';
import { funder, grantApplication, type Funder, type NewFunder } from '$lib/server/db/schema/grant';
import { asc, count, eq } from 'drizzle-orm';
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
			`${n} ${n === 1 ? 'application names' : 'applications name'} this funder. Delete ${n === 1 ? 'it' : 'them'} first.`
		);
	}
}

/** Every funder, with how many applications name it. */
export async function listFunders() {
	const [funders, apps] = await Promise.all([
		db.select().from(funder).orderBy(asc(funder.name)),
		db.select({ funderId: grantApplication.funderId }).from(grantApplication)
	]);
	return funders.map((f) => ({
		...f,
		applications: apps.filter((a) => a.funderId === f.id).length
	}));
}

export type FunderInput = Omit<NewFunder, 'id' | 'createdAt' | 'updatedAt'>;

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

/** Refused while any application names it: the history is the point. */
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
