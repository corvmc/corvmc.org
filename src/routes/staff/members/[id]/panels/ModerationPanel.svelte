<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getMemberStandings, restoreMemberStanding } from '$lib/remote/standing.remote';
	import Action from '$lib/components/ui/Action.svelte';
	import { getFlagsAgainstUser, getFlagsByUser } from '$lib/remote/flags.remote';
	import { RelatedList } from '$lib/components/ui/entity';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '$lib/utils/format';

	let { id }: { id: string } = $props();

	// Copy per scope, because "held for review" means something different on a
	// public calendar than it does on the suggestion board, and a generic
	// sentence would be true of both and useful for neither.
	const restrictedCopy: Record<string, { title: string; body: string }> = {
		community_event: {
			title: m.staff_community_listings(),
			body: "This member's listings are reviewed by staff before they go on the public calendar, after a report was upheld against one of them."
		},
		suggestion: {
			title: m.staff_members_id_panels_moderation_panel_suggestions(),
			body: "This member's suggestions are reviewed by staff before they go on the board, after a report was upheld against one of them."
		}
	};
</script>

<!--
	A standing is applied by the system when a report is upheld (`flag-service`
	calls `restrictStanding`); setting one by hand is a non-goal. Lifting one is
	the only write here, one scope at a time.

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
		<InfoCard title={m.staff_members_id_panels_moderation_panel_standing()}>
			<EmptyState
				title={m.staff_members_id_panels_moderation_panel_no_restrictions()}
				description={m.staff_members_id_panels_moderation_panel_nothing_member_post()}
			/>
		</InfoCard>
	{/if}
	{#each restricted as scope (scope)}
		{@const standing = standings[scope]}
		<InfoCard title={restrictedCopy[scope].title}>
			<p class="text-sm">{restrictedCopy[scope].body}</p>
			{#if standing.reason}
				<p class="mt-1 text-muted">{m.staff_staff_note({ reason: standing.reason })}</p>
			{/if}
			{#if standing.triggeringFlagId}
				<p class="mt-1 text-sm">
					<a class="link" href={resolve(`/staff/flags/${standing.triggeringFlagId}`)}>
						{m.staff_members_id_panels_moderation_panel_see_report()}
					</a>
				</p>
			{/if}
			<div class="mt-2">
				<Action
					action={restoreMemberStanding.for(scope)}
					label={m.staff_restore()}
					variant="ghost"
					size="sm"
					confirm="Stop holding this member's posts here for review?"
					successToast={m.staff_members_id_panels_moderation_panel_success_toast()}
				>
					{#snippet form()}
						{@const f = restoreMemberStanding.for(scope).fields}
						<input {...f.userId.as('hidden', id)} />
						<input {...f.scope.as('hidden', scope)} />
					{/snippet}
				</Action>
			</div>
		</InfoCard>
	{/each}
{/await}

<RelatedList
	title={m.staff_members_id_panels_moderation_panel_reports_against_mem()}
	result={getFlagsAgainstUser(id)}
>
	{#snippet children(flags)}
		{#if flags.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_moderation_panel_no_reports()}
				description={m.staff_members_id_panels_moderation_panel_nobody_has_reported()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_reason()}</th>
					<th class="col-extra">{m.staff_members_id_panels_moderation_panel_filed()}</th>
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

<RelatedList
	title={m.staff_members_id_panels_moderation_panel_reports_they_filed()}
	result={getFlagsByUser(id)}
>
	{#snippet children(flags)}
		{#if flags.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_moderation_panel_none_filed()}
				description={m.staff_members_id_panels_moderation_panel_member_has_not_repo()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_about()}</th>
					<th class="col-extra">{m.staff_members_id_panels_moderation_panel_filed()}</th>
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
