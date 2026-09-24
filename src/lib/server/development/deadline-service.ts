import { listGrantDeadlinesBetween } from '$lib/server/grant/grant-service';
import { listSponsorshipDeadlinesBetween } from '$lib/server/sponsor/sponsor-service';

/**
 * Development's deadlines across its two modules (#1477), for the reminder sweep
 * and the staff dashboard. Each module is read only when asked for, so a caller
 * that may see one module never loads the other.
 */
export async function listDevelopmentDeadlinesBetween(
	from: string,
	to: string,
	modules: { grants: boolean; sponsors: boolean }
) {
	const [grants, sponsors] = await Promise.all([
		modules.grants ? listGrantDeadlinesBetween(from, to) : [],
		modules.sponsors ? listSponsorshipDeadlinesBetween(from, to) : []
	]);
	return [
		...grants.map((d) => ({ ...d, module: 'grant' as const })),
		...sponsors.map((d) => ({ ...d, module: 'sponsor' as const }))
	].sort((a, b) => a.on.localeCompare(b.on));
}

export type DevelopmentDeadline = Awaited<
	ReturnType<typeof listDevelopmentDeadlinesBetween>
>[number];
