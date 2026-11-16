<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getMemberStandings, restoreMemberStanding } from '#lib/remote/standing.remote.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { getFlagsAgainstUser, getFlagsByUser } from '#lib/remote/flags.remote.js';
	import { RelatedList } from '#lib/components/ui/entity/index.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import { Latest } from '#lib/latest.svelte.js';

	let { id }: { id: string } = $props();

	// Copy per scope, because "held for review" means something different on a
	// public calendar than it does on the suggestion board, and a generic
	// sentence would be true of both and useful for neither.
	const restrictedCopy: Record<string, { title: string; body: string }> = {
		community_event: {
			title: m.staff_community_listings_title(),
			body: "This member's listings are reviewed by staff before they go on the public calendar, after a report was upheld against one of them."
		},
		suggestion: {
			title: m.staff_members_id_panels_moderation_panel_suggestions_title(),
			body: "This member's suggestions are reviewed by staff before they go on the board, after a report was upheld against one of them."
		}
	};

	// Not `{#await}`: a refresh would re-pend it and unmount an open Restore (#2356).
	const standingsQuery = new Latest(() => getMemberStandings(id));
	$effect(() => {
		if (standingsQuery.error) throw standingsQuery.error.e;
	});
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
{#if standingsQuery.current}
	{@const standings = standingsQuery.current}
	{@const restricted = (['community_event', 'suggestion'] as const).filter(
		(scope) => standings[scope].status !== 'none'
	)}
	{#if restricted.length === 0}
		<InfoCard title={m.staff_members_id_panels_moderation_panel_standing_title()}>
			<EmptyState
				title={m.staff_members_id_panels_moderation_panel_no_restrictions_title()}
				description={m.staff_members_id_panels_moderation_panel_nothing_member_post_body()}
			/>
		</InfoCard>
	{/if}
	{#each restricted as scope (scope)}
		{@const standing = standings[scope]}
		<InfoCard title={restrictedCopy[scope].title}>
			<p class="text-sm">{restrictedCopy[scope].body}</p>
			{#if standing.reason}
				<p class="mt-1 text-muted">{m.staff_staff_note_text({ reason: standing.reason })}</p>
			{/if}
			{#if standing.triggeringFlagId}
				<p class="mt-1 text-sm">
					<a class="link" href={resolve(`staff/flags/${standing.triggeringFlagId}`)}>
						{m.staff_members_id_panels_moderation_panel_see_report_text()}
					</a>
				</p>
			{/if}
			<div class="mt-2">
				<Action
					action={restoreMemberStanding.for(scope)}
					label={m.staff_restore_label()}
					variant="ghost"
					size="sm"
					confirm={m.staff_members_id_panels_moderation_panel_confirm_body()}
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
{/if}

<RelatedList
	title={m.staff_members_id_panels_moderation_panel_reports_against_mem_title()}
	result={getFlagsAgainstUser(id)}
>
	{#snippet children(flags)}
		{#if flags.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_moderation_panel_no_reports_title()}
				description={m.staff_members_id_panels_moderation_panel_nobody_has_reported_body()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_reason_label()}</th>
					<th class="col-extra">{m.staff_members_id_panels_moderation_panel_filed_label()}</th>
				{/snippet}
				{#each flags as f (f.id)}
					<tr class="hover" use:rowLink={resolve(`staff/flags/${f.id}`)}>
						<td class="w-px"><StatusBadge status={f.status} /></td>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`staff/flags/${f.id}`)}>{f.reason}</a>
							<div class="text-muted">
								{m.staff_members_id_panels_moderation_panel_by_text({
									reportedByName:
										f.reportedByName ?? m.staff_members_id_panels_moderation_panel_anonymous_text()
								})}
							</div>
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(f.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList
	title={m.staff_members_id_panels_moderation_panel_reports_they_filed_title()}
	result={getFlagsByUser(id)}
>
	{#snippet children(flags)}
		{#if flags.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_moderation_panel_none_filed_title()}
				description={m.staff_members_id_panels_moderation_panel_member_has_not_repo_body()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_about_label()}</th>
					<th class="col-extra">{m.staff_members_id_panels_moderation_panel_filed_label()}</th>
				{/snippet}
				{#each flags as f (f.id)}
					<tr class="hover" use:rowLink={resolve(`staff/flags/${f.id}`)}>
						<td class="w-px"><StatusBadge status={f.status} /></td>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`staff/flags/${f.id}`)}>{f.entityLabel}</a>
							<div class="text-muted">{f.reason}</div>
						</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(f.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>
