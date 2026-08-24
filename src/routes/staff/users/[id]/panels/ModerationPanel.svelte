<script lang="ts">
	import { getMemberStandings } from '$lib/remote/standing.remote';
	import { getFlagsAgainstUser, getFlagsByUser } from '$lib/remote/flags.remote';
	import { RelatedList } from '$lib/components/shared/entity';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '$lib/utils/format';

	let { id }: { id: string } = $props();

	// Copy per scope, because "held for review" means something different on a
	// public calendar than it does on the suggestion board, and a generic
	// sentence would be true of both and useful for neither.
	const restrictedCopy: Record<string, { title: string; body: string }> = {
		community_event: {
			title: 'Community listings',
			body: "This member's listings are reviewed by staff before they go on the public calendar, after a report was upheld against one of them."
		},
		suggestion: {
			title: 'Suggestions',
			body: "This member's suggestions are reviewed by staff before they go on the board, after a report was upheld against one of them."
		}
	};
</script>

<!--
	Read-only, and deliberately so. A standing is applied by the system when a
	report is upheld (`flag-service` calls `restrictStanding`), and it is lifted
	through the appeal workflow — setting one by hand from a member's record is a
	non-goal, so this panel reports state rather than offering a switch.

	The two scopes render only when they are bad. A "standing: fine" card on every
	member would be noise, and the point of these is that they appear when
	something happened. They stay separate cards, not one merged "standing" card,
	because they are separate decisions: an upheld report about an event must not
	quietly cost someone their suggestion-posting rights, or the reverse.
-->
{#await getMemberStandings(id) then standings}
	{@const restricted = (['community_event', 'suggestion'] as const).filter(
		(scope) => standings[scope].status !== 'none'
	)}
	{#if restricted.length === 0}
		<InfoCard title="Standing">
			<EmptyState
				title="No restrictions"
				description="Nothing this member posts is held for review."
			/>
		</InfoCard>
	{/if}
	{#each restricted as scope (scope)}
		{@const standing = standings[scope]}
		<InfoCard title={restrictedCopy[scope].title}>
			<p class="text-sm">{restrictedCopy[scope].body}</p>
			{#if standing.reason}
				<p class="mt-1 text-muted">Staff note: "{standing.reason}"</p>
			{/if}
			{#if standing.triggeringFlagId}
				<p class="mt-1 text-sm">
					<a class="link" href={resolve(`/staff/flags/${standing.triggeringFlagId}`)}>
						See the report
					</a>
				</p>
			{/if}
		</InfoCard>
	{/each}
{/await}

<RelatedList title="Reports against this member" result={getFlagsAgainstUser(id)}>
	{#snippet children(flags)}
		{#if flags.length === 0}
			<EmptyState title="No reports" description="Nobody has reported this member's profile." />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Reason</th>
					<th class="col-extra">Filed</th>
				{/snippet}
				{#each flags as f (f.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/flags/${f.id}`)}>
						<td class="w-px"><StatusBadge status={f.status} /></td>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/flags/${f.id}`)}>{f.reason}</a>
							<div class="text-muted">by {f.reportedByName ?? 'Anonymous'}</div>
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(f.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList title="Reports they filed" result={getFlagsByUser(id)}>
	{#snippet children(flags)}
		{#if flags.length === 0}
			<EmptyState title="None filed" description="This member has not reported anyone." />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>About</th>
					<th class="col-extra">Filed</th>
				{/snippet}
				{#each flags as f (f.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/flags/${f.id}`)}>
						<td class="w-px"><StatusBadge status={f.status} /></td>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/flags/${f.id}`)}>{f.entityLabel}</a>
							<div class="text-muted">{f.reason}</div>
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(f.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>
