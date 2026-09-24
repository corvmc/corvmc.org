<script lang="ts">
	/** Ballots as a list, for the member and staff index pages. */
	import { resolve } from '$app/paths';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import {
		ballotKindLabels,
		ballotStatusLabels,
		type BallotKind,
		type BallotStatus
	} from '$lib/config';
	import { formatDateShortYear } from '$lib/utils/format';

	type Row = {
		id: string;
		kind: BallotKind;
		title: string;
		status: BallotStatus;
		closesAt: Date;
		groupName: string | null;
		isElector: boolean;
		hasVoted: boolean;
		isCertifier: boolean;
	};

	let { rows, panel }: { rows: Row[]; panel: 'member' | 'staff' } = $props();

	function href(id: string) {
		return panel === 'staff' ? resolve(`/staff/ballots/${id}`) : resolve(`/member/ballots/${id}`);
	}

	/** What the list owes this member, if anything. */
	function yourPart(r: Row): string {
		if (r.isCertifier && r.status === 'closed') return 'Certify';
		if (r.isElector && r.status === 'open') return r.hasVoted ? 'Voted' : 'Vote now';
		if (r.isElector && r.hasVoted) return 'Voted';
		return '—';
	}
</script>

<Table>
	{#snippet head()}
		<th class="w-px"><span class="sr-only">Status</span></th>
		<th>Ballot</th>
		<th>Closes</th>
		{#if panel === 'member'}
			<th class="col-support">Your part</th>
		{/if}
	{/snippet}
	{#each rows as r (r.id)}
		<tr class="hover cursor-pointer" use:rowLink={href(r.id)}>
			<td class="w-px">
				<StatusBadge status={r.status} text={ballotStatusLabels[r.status]} />
			</td>
			<td class="cell-primary">
				<a class="link font-medium" href={href(r.id)}>{r.title}</a>
				<div class="truncate text-muted">{r.groupName ?? ballotKindLabels[r.kind]}</div>
			</td>
			<td class="whitespace-nowrap">{formatDateShortYear(r.closesAt)}</td>
			{#if panel === 'member'}
				<td class="col-support">{yourPart(r)}</td>
			{/if}
		</tr>
	{/each}
</Table>
