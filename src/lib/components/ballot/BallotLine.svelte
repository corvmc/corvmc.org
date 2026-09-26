<script lang="ts">
	/**
	 * A ballot as one line on another page: its question, status and, once
	 * certified, the published counts. Never a live tally.
	 */
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { ballotStatusLabels, type BallotStatus } from '$lib/config';
	import { formatDateShortYear } from '$lib/utils/format';

	type Line = {
		title: string;
		status: BallotStatus;
		closesAt: Date;
		result: { options: { optionId: string; label: string; votes: number }[] } | null;
		passed: boolean | null;
	};

	let { ballot, href = null }: { ballot: Line; href?: string | null } = $props();
</script>

<span class="inline-flex flex-wrap items-center gap-2">
	{#if href}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass a resolved path -->
		<a class="link" {href}>{ballot.title}</a>
	{:else}
		<span>{ballot.title}</span>
	{/if}
	<StatusBadge status={ballot.status} label text={ballotStatusLabels[ballot.status]} />
</span>
{#if ballot.result}
	<span class="block text-muted">
		{ballot.result.options.map((o) => `${o.label} ${o.votes}`).join(' · ')}
		— {ballot.passed ? 'passed' : 'did not pass'}
	</span>
{:else if ballot.status === 'open'}
	<span class="block text-muted">Voting closes {formatDateShortYear(ballot.closesAt)}</span>
{/if}
