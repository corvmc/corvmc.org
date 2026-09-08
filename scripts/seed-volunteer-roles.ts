/**
 * Bootstrap the canonical volunteer roles.
 *
 * Usage:
 *   pnpm volunteer:seed-roles            # show what would change
 *   pnpm volunteer:seed-roles --write    # insert the missing ones
 *
 * Idempotent, and additive only: a role whose name already exists is left
 * exactly as it is, name, description, group and all. Roles are staff-managed
 * — the whole point of the table — so this script's job is to save someone
 * typing sixteen job descriptions into a form, not to own them afterwards.
 *
 * Safe against production for the same reason, but it defaults to a dry run so
 * you can read the plan before it writes.
 */
import 'dotenv/config';
import { getPlatformProxy } from 'wrangler';
import { drizzle } from 'drizzle-orm/d1';
import { volunteerRole } from '../src/lib/server/db/schema/volunteer';

type Group = 'at-shows' | 'away-from-shows' | 'committee';

interface RoleSeed {
	name: string;
	group: Group;
	description: string;
}

// Wording follows the volunteer interest form these came from — members
// recognize the role by its description, not its title.
const ROLES: RoleSeed[] = [
	{
		name: 'Host',
		group: 'at-shows',
		description: 'Run the room: welcome bands, introduce sets, keep things running on schedule.'
	},
	{ name: 'Tech', group: 'at-shows', description: 'Operate the soundboard and run soundcheck.' },
	{
		name: 'Door',
		group: 'at-shows',
		description: 'Handle the entry fee, welcome audience members, and keep an eye on the space.'
	},
	{
		name: 'Merch',
		group: 'at-shows',
		description: 'Handle CMC merch and concessions, and coordinate band merch tables.'
	},
	{
		name: 'Photos or Video',
		group: 'at-shows',
		description: 'Document the show with photography or video, using your own equipment.'
	},

	{ name: 'Street Team', group: 'away-from-shows', description: 'Put up posters around town.' },
	{
		name: 'Tabling',
		group: 'away-from-shows',
		description: 'Staff a table at festivals and community events.'
	},
	{
		name: 'Work Parties',
		group: 'away-from-shows',
		description: 'Cleaning, organizing, and building projects.'
	},
	{
		name: 'Gear Repair',
		group: 'away-from-shows',
		description: 'Clean, maintain, and repair gear library equipment.'
	},
	{
		name: 'Audio Engineering',
		group: 'away-from-shows',
		description: 'Assist members with recording, mixing, or mastering.'
	},

	{
		name: 'Programming Committee',
		group: 'committee',
		description: 'Planning and booking CMC-produced events. Meets monthly.'
	},
	{
		name: 'Production Committee',
		group: 'committee',
		description: 'Operating, staffing, and running CMC events. Meets monthly.'
	},
	{
		name: 'Development Committee',
		group: 'committee',
		description:
			'Fundraising, member and partner development, business and venue outreach. Meets monthly.'
	},
	{
		name: 'Communications Committee',
		group: 'committee',
		description: 'Social media, posters, press, and the newsletter. Meets monthly.'
	},
	{
		name: 'Art and Merchandise Committee',
		group: 'committee',
		description:
			'Create and manage CMC merch, and work with local artists on poster art. Meets monthly.'
	},
	{
		name: 'Facility Committee',
		group: 'committee',
		description:
			'Building management, gear library maintenance, rehearsal scheduling. Meets monthly.'
	}
];

async function main() {
	const write = process.argv.includes('--write');
	// `src/app.d.ts` is where this project's bindings are named; without the
	// type argument `env` is `unknown` and `env.DB` is unchecked.
	const { env, dispose } = await getPlatformProxy<NonNullable<App.Platform['env']>>();
	const db = drizzle(env.DB);

	const existing = await db
		.select({ name: volunteerRole.name, group: volunteerRole.group })
		.from(volunteerRole);
	const have = new Map(existing.map((r) => [r.name.toLowerCase(), r]));

	const missing = ROLES.filter((r) => !have.has(r.name.toLowerCase()));
	const present = ROLES.filter((r) => have.has(r.name.toLowerCase()));
	// Roles the org already had that this script doesn't know about. Not a
	// problem — just the thing you want to see before deciding you're done.
	const unknown = existing.filter(
		(e) => !ROLES.some((r) => r.name.toLowerCase() === e.name.toLowerCase())
	);

	console.log(`\n${existing.length} role(s) already in the database.\n`);

	if (present.length > 0) {
		console.log(`Leaving alone (already present by name):`);
		for (const r of present) console.log(`  · ${r.name}`);
		console.log('');
	}

	if (unknown.length > 0) {
		console.log(`Already there and not in this script — check the group is right:`);
		for (const r of unknown) console.log(`  · ${r.name}  [${r.group}]`);
		console.log('');
	}

	if (missing.length === 0) {
		console.log('Nothing to add.\n');
		await dispose();
		return;
	}

	console.log(`Would add ${missing.length} role(s):`);
	for (const r of missing) console.log(`  + ${r.name}  [${r.group}]`);
	console.log('');

	if (!write) {
		console.log('Dry run. Re-run with --write to insert.\n');
		await dispose();
		return;
	}

	// displayOrder follows the order in this file so the groups read the way the
	// form does, offset past anything already there.
	const offset = existing.length;
	let i = 0;
	for (const role of missing) {
		await db.insert(volunteerRole).values({
			name: role.name,
			description: role.description,
			group: role.group,
			displayOrder: offset + i++,
			isActive: true
		});
	}

	console.log(`Added ${missing.length} role(s).\n`);
	await dispose();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
