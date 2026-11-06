<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import type { Snippet } from 'svelte';
	import RecordFrame from '#lib/components/ui/RecordFrame.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '#lib/utils/format.js';
	import {
		deactivateGroup,
		reactivateGroup,
		setStaffGroupRole,
		getGroupHistory,
		type getStaffGroupPage
	} from '#lib/remote/groups.remote.js';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';
	import GroupSettingsForm from './GroupSettingsForm.svelte';
	import AddChairAction from './AddChairAction.svelte';
	import CommitteeGrantsCard from './CommitteeGrantsCard.svelte';
	import RosterImportAction from './RosterImportAction.svelte';
	import RosterTable from '#lib/components/roster/RosterTable.svelte';
	import CopyEmailsButton from '#lib/components/roster/CopyEmailsButton.svelte';
	import RosterImportSummary from './RosterImportSummary.svelte';
	import type { RosterImportResult } from '#lib/types/roster-import.js';

	type StaffGroupPage = Awaited<ReturnType<typeof getStaffGroupPage>>;

	/**
	 * A club's or committee's staff record, as a page or a side panel. Each kind
	 * runs its own one query and hands the result here; `applications` is each
	 * kind's own review card.
	 */
	let {
		group,
		members,
		applications,
		variant = 'page',
		actions
	}: {
		group: StaffGroupPage['group'];
		members: StaffGroupPage['members'];
		applications?: Snippet;
		variant?: 'page' | 'panel';
		actions?: Snippet;
	} = $props();

	const deactivateFields = deactivateGroup.fields;
	const reactivateFields = reactivateGroup.fields;
	const roleFields = setStaffGroupRole.fields;

	const id = $derived(group.id);
	const isDeactivated = $derived(!!group.deletedAt);

	let importResult = $state<RosterImportResult | null>(null);
</script>

<!-- The two facts beside
     the badge are the ones the list row carries and this page dropped —
     `getGroupDetail` has returned both all along (#1070). -->
<RecordFrame
	{variant}
	{actions}
	title={group.name}
	subtitle={group.kind === 'committee'
		? msg.groups_staff_group_detail_committee()
		: msg.groups_staff_group_detail_club()}
>
	{#snippet header()}
		<StatusBadge status={isDeactivated ? 'deactivated' : 'active'} />
		<span class="text-muted">
			{msg.groups_staff_group_detail_members_since({
				memberCount: group.memberCount,
				formatDateShortYear: formatDateShortYear(group.createdAt)
			})}
		</span>
		{#if !isDeactivated}
			<AddChairAction groupId={id} />
		{/if}
	{/snippet}
	{#if isDeactivated}
		<!-- Deactivation is the normal end of a program: nothing is removed and
		     nobody loses their place, so putting it back is one control rather
		     than a recovery procedure. -->
		<InfoCard title={msg.groups_staff_group_detail_deactivated()}>
			<p class="text-sm">
				{msg.groups_staff_group_detail_group_hidden_from_directory_its()}
			</p>
			<Action
				action={reactivateGroup}
				label={msg.groups_staff_group_detail_reactivate()}
				modalTitle={msg.groups_staff_group_detail_reactivate_group()}
				submitLabel={msg.groups_staff_group_detail_reactivate()}
				confirm={msg.groups_staff_group_detail_put_back_directory({ name: group.name })}
				successToast={msg.groups_staff_group_detail_reactivated()}
				variant="primary"
				size="sm"
				onsuccess={() => refreshAll()}
			>
				{#snippet form()}
					<input {...reactivateFields.groupId.as('hidden', id)} />
				{/snippet}
			</Action>
		</InfoCard>
	{/if}

	{#if importResult}
		<RosterImportSummary result={importResult} ondismiss={() => (importResult = null)} />
	{/if}

	<InfoCard title={msg.groups_staff_group_detail_roster()}>
		{#snippet action()}
			<div class="flex gap-1">
				{#if members.active.length > 0}
					<CopyEmailsButton emails={members.active.map((m) => m.email)} />
				{/if}
				{#if !isDeactivated}
					<RosterImportAction groupId={id} onresult={(r) => (importResult = r)} />
				{/if}
			</div>
		{/snippet}
		{#if members.active.length === 0 && members.pending.length === 0}
			<EmptyState description={msg.groups_staff_group_detail_description()} />
		{:else}
			<!-- A position, where there is one, is the name's subline (`getMembers`). -->
			<RosterTable
				rows={[...members.active, ...members.pending]}
				personLabel={msg.groups_staff_group_detail_person_label()}
			>
				{#snippet lead(m)}<StatusBadge status={m.status} />{/snippet}
				{#snippet columns()}
					<th class="w-px">{msg.groups_staff_group_detail_role()}</th>
					<th class="whitespace-nowrap">{msg.groups_staff_group_detail_joined()}</th>
				{/snippet}
				{#snippet cells(m)}
					<td class="w-px"><Badge variant="ghost">{m.role}</Badge></td>
					<td class="whitespace-nowrap">{formatDateShort(m.createdAt)}</td>
				{/snippet}
				{#snippet actions(m)}
					{#if !isDeactivated && m.role !== 'owner'}
						{@const makeChair = m.role !== 'admin'}
						<Action
							action={setStaffGroupRole.for(m.id)}
							label={makeChair
								? msg.groups_staff_group_detail_make_chair()
								: msg.groups_staff_group_detail_remove_chair()}
							aria-label={makeChair
								? msg.groups_staff_group_detail_make_chair_2({ title: m.member.title })
								: msg.groups_staff_group_detail_remove_as_chair({ title: m.member.title })}
							confirm={makeChair
								? msg.groups_staff_group_detail_make_chair_3({
										title: m.member.title,
										name: group.name
									})
								: msg.groups_staff_group_detail_remove_as_chair_they_stay({
										title: m.member.title
									})}
							successToast={makeChair
								? msg.groups_staff_group_detail_chair_added()
								: msg.groups_staff_group_detail_chair_removed()}
							variant="ghost"
							size="xs"
							onsuccess={() => refreshAll()}
						>
							{#snippet form()}
								<input {...roleFields.groupId.as('hidden', id)} />
								<input {...roleFields.userId.as('hidden', m.userId)} />
								<input {...roleFields.role.as('hidden', makeChair ? 'admin' : 'member')} />
							{/snippet}
						</Action>
					{/if}
				{/snippet}
			</RosterTable>
		{/if}
	</InfoCard>

	<GroupSettingsForm
		groupId={id}
		joinPolicy={group.joinPolicy}
		joinInstructions={group.joinInstructions}
		visibility={group.visibility}
		policyFixed={group.kind === 'committee'}
	/>

	{#if group.kind === 'committee'}
		<CommitteeGrantsCard groupId={id} name={group.name} held={group.capabilityGrants ?? []} />
	{/if}

	{@render applications?.()}

	<!-- One line each, so labelled facts rather than cards of their own (#1078). -->
	<DefinitionList>
		<!-- No chairs is legal: the program runs, and staff add one when appointed. -->
		<Fact label={msg.groups_staff_group_detail_chairs()}>
			{#if group.chairs.length === 0}
				<span class="text-fg-2">{msg.groups_staff_group_detail_no_chairs()}</span>
			{:else}
				<span class="flex flex-wrap gap-2">
					{#each group.chairs as chair (chair.id)}
						<EntityChip ref={chair} icon={false} />
					{/each}
				</span>
			{/if}
		</Fact>
		<Fact label={msg.groups_staff_group_detail_public_page()}>
			{#if group.visibility === 'public'}
				<a class="link link-primary" href={resolve(`groups/${group.slug}`)}
					>{msg.groups_staff_group_detail_groups({ slug: group.slug })}</a
				>
			{:else}
				<span class="text-fg-2">
					<ParaglideMessage
						message={msg.groups_staff_group_detail_not_listed_publicly_set_visibility}
						inputs={{ slug: group.slug }}
						>{#snippet code({ children })}<code class="text-xs">{@render children?.()}</code
							>{/snippet}</ParaglideMessage
					>
				</span>
			{/if}
		</Fact>
	</DefinitionList>

	{#if variant === 'page'}
		<ActivityFeedCard
			title={msg.groups_staff_group_detail_history()}
			query={(limit) => getGroupHistory(limit ? { id, limit } : { id })}
			toRow={feedItemRow}
			empty={{ title: msg.groups_staff_group_detail_no_recorded_changes() }}
		/>
	{/if}

	{#if !isDeactivated}
		<InfoCard title={msg.groups_staff_group_detail_end_program()}>
			<p class="text-sm">
				{msg.groups_staff_group_detail_deactivating_hides_from_directory()}
			</p>
			<Action
				action={deactivateGroup}
				label={msg.groups_staff_group_detail_deactivate()}
				modalTitle={msg.groups_staff_group_detail_deactivate_group()}
				submitLabel={msg.groups_staff_group_detail_deactivate()}
				confirm={msg.groups_staff_group_detail_deactivate_its_roster_history_stay({
					name: group.name
				})}
				successToast={msg.groups_staff_group_detail_deactivated()}
				variant="error"
				size="sm"
				outline
				onsuccess={() => refreshAll()}
			>
				{#snippet form()}
					<input {...deactivateFields.groupId.as('hidden', id)} />
				{/snippet}
			</Action>
		</InfoCard>
	{/if}
</RecordFrame>
