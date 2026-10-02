<script lang="ts">
	import type { Snippet } from 'svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateShortYear } from '$lib/utils/format';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import {
		deactivateGroup,
		reactivateGroup,
		setStaffGroupRole,
		type getStaffGroupPage
	} from '$lib/remote/groups.remote';
	import GroupSettingsForm from './GroupSettingsForm.svelte';
	import AddChairAction from './AddChairAction.svelte';
	import CommitteeGrantsCard from './CommitteeGrantsCard.svelte';
	import RosterImportAction from './RosterImportAction.svelte';
	import RosterImportSummary from './RosterImportSummary.svelte';
	import type { RosterImportResult } from '$lib/types/roster-import';

	type StaffGroupPage = Awaited<ReturnType<typeof getStaffGroupPage>>;

	/**
	 * A club's or committee's staff page, shared by `/staff/clubs/[id]` and
	 * `/staff/committees/[id]`. Each route runs its own one query and hands the
	 * result here; `applications` is each route's own review card.
	 */
	let {
		group,
		members,
		applications
	}: {
		group: StaffGroupPage['group'];
		members: StaffGroupPage['members'];
		applications?: Snippet;
	} = $props();

	const deactivateFields = deactivateGroup.fields;
	const reactivateFields = reactivateGroup.fields;
	const roleFields = setStaffGroupRole.fields;

	const id = $derived(group.id);
	const isDeactivated = $derived(!!group.deletedAt);
	const backHref = $derived(group.kind === 'committee' ? '/staff/committees' : '/staff/clubs');

	let importResult = $state<RosterImportResult | null>(null);
</script>

<!-- `backHref` because this was the only staff `[id]` page without one: the
     browser's Back button was the only way to the list. The two facts beside
     the badge are the ones the list row carries and this page dropped —
     `getGroupDetail` has returned both all along (#1070). -->
<PageHeader
	width="3xl"
	title={group.name}
	subtitle={group.kind === 'committee' ? 'Committee' : 'Club'}
	{backHref}
>
	<StatusBadge status={isDeactivated ? 'deactivated' : 'active'} />
	<span class="text-muted">
		{group.memberCount}
		{group.memberCount === 1 ? 'member' : 'members'} · since {formatDateShortYear(group.createdAt)}
	</span>
	{#if !isDeactivated}
		<AddChairAction groupId={id} />
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if isDeactivated}
		<!-- Deactivation is the normal end of a program: nothing is removed and
		     nobody loses their place, so putting it back is one control rather
		     than a recovery procedure. -->
		<InfoCard title="Deactivated">
			<p class="text-sm">
				This group is hidden from the directory and its page. Its roster, its documents and its
				history are untouched.
			</p>
			<Action
				action={reactivateGroup}
				label="Reactivate"
				modalTitle="Reactivate group"
				submitLabel="Reactivate"
				confirm="Put {group.name} back in the directory?"
				successToast="Reactivated"
				variant="primary"
				size="sm"
				onsuccess={() => invalidateAll()}
			>
				{#snippet form()}
					<input {...reactivateFields.groupId.as('hidden', id)} />
				{/snippet}
			</Action>
		</InfoCard>
	{/if}

	<GroupSettingsForm
		groupId={id}
		joinPolicy={group.joinPolicy}
		joinInstructions={group.joinInstructions}
		visibility={group.visibility}
	/>

	{#if group.kind === 'committee'}
		<CommitteeGrantsCard groupId={id} name={group.name} held={group.capabilityGrants ?? []} />
	{/if}

	{@render applications?.()}

	{#if importResult}
		<RosterImportSummary result={importResult} ondismiss={() => (importResult = null)} />
	{/if}

	<InfoCard title="Roster">
		{#snippet action()}
			{#if !isDeactivated}
				<RosterImportAction groupId={id} onresult={(r) => (importResult = r)} />
			{/if}
		{/snippet}
		{#if members.active.length === 0 && members.pending.length === 0}
			<EmptyState description="No members yet" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Member</th>
					<th class="w-px">Role</th>
					<th>Position</th>
					<th class="whitespace-nowrap">Joined</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each [...members.active, ...members.pending] as m (m.id)}
					<tr>
						<td class="w-px"><StatusBadge status={m.status} /></td>
						<td class="cell-primary"><EntityIdentity ref={m.member} /></td>
						<td class="w-px"><Badge variant="ghost">{m.role}</Badge></td>
						<td>{m.position ?? '—'}</td>
						<td class="whitespace-nowrap">{formatDateShort(m.createdAt)}</td>
						<td class="w-px">
							{#if !isDeactivated && m.role !== 'owner'}
								{@const makeChair = m.role !== 'admin'}
								<Action
									action={setStaffGroupRole.for(m.id)}
									label={makeChair ? 'Make chair' : 'Remove chair'}
									aria-label={makeChair
										? `Make ${m.member.title} a chair`
										: `Remove ${m.member.title} as a chair`}
									confirm={makeChair
										? `Make ${m.member.title} a chair of ${group.name}?`
										: `Remove ${m.member.title} as a chair? They stay on the roster.`}
									successToast={makeChair ? 'Chair added' : 'Chair removed'}
									variant="ghost"
									size="xs"
									onsuccess={() => invalidateAll()}
								>
									{#snippet form()}
										<input {...roleFields.groupId.as('hidden', id)} />
										<input {...roleFields.userId.as('hidden', m.userId)} />
										<input {...roleFields.role.as('hidden', makeChair ? 'admin' : 'member')} />
									{/snippet}
								</Action>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<!-- One line each, so labelled facts rather than cards of their own (#1078). -->
	<DefinitionList>
		<!-- No chairs is legal: the program runs, and staff add one when appointed. -->
		<Fact label="Chairs">
			{#if group.chairs.length === 0}
				<span class="text-fg-2">No chairs</span>
			{:else}
				<span class="flex flex-wrap gap-2">
					{#each group.chairs as chair (chair.id)}
						<EntityChip ref={chair} icon={false} />
					{/each}
				</span>
			{/if}
		</Fact>
		<Fact label="Public page">
			{#if group.visibility === 'public'}
				<a class="link link-primary" href={resolve(`/groups/${group.slug}`)}>/groups/{group.slug}</a
				>
			{:else}
				<span class="text-fg-2">
					Not listed publicly. Set visibility to Public above and it appears at
					<code class="text-xs">/groups/{group.slug}</code>.
				</span>
			{/if}
		</Fact>
	</DefinitionList>

	{#if !isDeactivated}
		<InfoCard title="End this program">
			<p class="text-sm">
				Deactivating hides it from the directory and its public page. Nothing is deleted, no member
				loses their place, and it can be put back.
			</p>
			<Action
				action={deactivateGroup}
				label="Deactivate"
				modalTitle="Deactivate group"
				submitLabel="Deactivate"
				confirm="Deactivate {group.name}? Its roster and history stay intact and you can reactivate it later."
				successToast="Deactivated"
				variant="error"
				size="sm"
				outline
				onsuccess={() => invalidateAll()}
			>
				{#snippet form()}
					<input {...deactivateFields.groupId.as('hidden', id)} />
				{/snippet}
			</Action>
		</InfoCard>
	{/if}
</PageContent>
