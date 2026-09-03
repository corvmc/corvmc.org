import type { RequestHandler } from './$types';
import { requireGroupRole } from '$lib/server/group/group-context';
import { getRider } from '$lib/server/band/rider-service';
import { getMembers } from '$lib/server/band/band-service';
import { toCsv, csvResponse } from '$lib/server/report/csv';
import {
	riderElementKindLabels,
	riderInputSourceLabels,
	riderProvidedByLabels,
	riderStandTypeLabels
} from '$lib/config';

const COLUMNS = [
	'channel',
	'source',
	'item',
	'owner',
	'kind',
	'via',
	'mic_or_di',
	'stand',
	'phantom_48v',
	'monitor_mix',
	'provided_by',
	'notes'
];

/**
 * The input list as a file an engineer can take away.
 *
 * **A `+server.ts` rather than a remote function**, for the reason the volunteer
 * export gives: a download needs `Content-Disposition` and a `query()` returns a
 * value rather than a response. So the guard is not the remote-function boundary
 * here and `requireGroupRole` is the first statement — `allowStaff`, because a
 * staffer advancing a show needs this more than the band does.
 *
 * The `slug` is a real route param rather than a client-supplied header, which
 * is the case where reading `params` is honest: it named the page that was
 * fetched, and the guard resolves the band from it and then checks membership on
 * the *resolved* band.
 *
 * Every field is band-authored text and staff open these in Excel, which is what
 * `toCsv` forcing `escape_formulas` is for.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { group: band } = await requireGroupRole({ slug: params.slug }, 'member', {
		allowStaff: true
	});

	const [rider, members] = await Promise.all([getRider(band.id), getMembers(band.id)]);
	const nameFor = new Map(members.map((m) => [m.userId, m.member.title ?? 'Member']));

	// An index signature rather than a plain interface: `toCsv` takes
	// `Record<string, unknown>[]`, and an interface without one is not assignable
	// to it even when every field is a string.
	interface Row extends Record<string, string> {
		channel: string;
		source: string;
		item: string;
		owner: string;
		kind: string;
		via: string;
		mic_or_di: string;
		stand: string;
		phantom_48v: string;
		monitor_mix: string;
		provided_by: string;
		notes: string;
	}

	const ownerOf = (userId: string | null) => (userId ? (nameFor.get(userId) ?? '') : '');

	const rows: Row[] = rider.elements.flatMap((el): Row[] => {
		const shared = {
			item: el.label,
			owner: ownerOf(el.userId),
			kind: riderElementKindLabels[el.kind],
			provided_by: riderProvidedByLabels[el.providedBy]
		};

		// An element with no inputs is still on the stage — a wedge, or a backline
		// request — and dropping it would lose exactly the rows the venue is being
		// asked to act on. The channel is blank rather than zero: it takes no
		// channel, rather than taking channel nought.
		if (el.inputs.length === 0) {
			return [
				{
					...shared,
					channel: '',
					source: '',
					via: '',
					mic_or_di: '',
					stand: '',
					phantom_48v: '',
					monitor_mix: '',
					notes: el.notes ?? ''
				}
			];
		}

		return el.inputs.map((input) => ({
			...shared,
			// A string throughout, so the two branches agree and a spreadsheet
			// reads the column as one type.
			channel: String(input.channel),
			source: input.label,
			via: riderInputSourceLabels[input.source],
			mic_or_di: input.micPref ?? '',
			stand: riderStandTypeLabels[input.stand],
			phantom_48v: input.phantom ? 'yes' : 'no',
			monitor_mix: ownerOf(input.monitorMixUserId),
			notes: input.notes ?? el.notes ?? ''
		}));
	});

	const csv = toCsv(rows, COLUMNS);

	// The totals ride in a comment line, the way the volunteer export carries its
	// rate: a file that outlives the page it came from has to say what it counted.
	const header =
		`# ${band.name} — input list. ${rider.channelCount} channels, ` +
		`${rider.phantomCount} needing +48V, ${rider.monitorMixCount} monitor mixes, ` +
		`${rider.venueProvidedCount} item(s) needed from the venue.\n`;

	return csvResponse(`${band.slug}-input-list.csv`, header + csv);
};
