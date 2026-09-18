import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/authorization';
import { getById } from '$lib/server/event/event-service';
import { getBillInputList } from '$lib/server/band/bill-input-list-service';
import { config } from '$lib/server/site-config/site-config-service';
import { toCsv, csvResponse } from '$lib/server/report/csv';
import { riderInputSourceLabels, riderStandTypeLabels } from '$lib/config';
import { error } from '@sveltejs/kit';

const COLUMNS = [
	'channel',
	'act',
	'source',
	'item',
	'owner',
	'via',
	'mic_or_di',
	'stand',
	'phantom_48v',
	'shared_with',
	'notes'
];

/**
 * The bill's input list as a file.
 *
 * A `+server.ts` rather than a remote function for the reason the per-band
 * export gives: a download needs `Content-Disposition` and a `query()` returns
 * a value. So `requireCapability` is the first statement.
 */
export const GET: RequestHandler = async ({ params }) => {
	await requireCapability('event.read');

	const [evt, consoleChannels] = await Promise.all([
		getById(params.id),
		config<number>('venue.consoleChannels')
	]);
	if (!evt) throw error(404, 'Event not found');

	const list = await getBillInputList(params.id, Number(consoleChannels) || 0);

	// An index signature, because `toCsv` takes `Record<string, unknown>[]` and
	// a plain interface is not assignable to it even when every field is a string.
	interface Row extends Record<string, string> {
		channel: string;
		act: string;
		source: string;
		item: string;
		owner: string;
		via: string;
		mic_or_di: string;
		stand: string;
		phantom_48v: string;
		shared_with: string;
		notes: string;
	}

	const rows: Row[] = list.channels.map((c) => ({
		channel: String(c.channel),
		act: c.actName,
		source: c.label,
		item: c.elementLabel,
		owner: c.ownerName ?? '',
		via: riderInputSourceLabels[c.source],
		mic_or_di: c.micPref ?? '',
		stand: riderStandTypeLabels[c.stand],
		phantom_48v: c.phantom ? 'yes' : 'no',
		shared_with: c.sharedWith.join('; '),
		notes: c.notes ?? ''
	}));

	// The totals ride in a comment line the way the per-band export carries its
	// own: a file that outlives the page it came from has to say what it counted.
	const header =
		`# ${evt.title} — input list for the bill. ${list.channelCount} channels ` +
		`(${list.distinctCount} if every repeated source is patched once), ` +
		`${list.phantomCount} needing +48V, desk takes ${list.consoleChannels}.\n`;

	const slug = evt.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

	return csvResponse(`${slug || 'event'}-input-list.csv`, header + toCsv(rows, COLUMNS));
};
