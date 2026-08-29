<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { getStaffGroupPage, deactivateGroup, reactivateGroup } from '$lib/remote/groups.remote';
	import GroupSettingsForm from './GroupSettingsForm.svelte';
	import AssignLeaderAction from './AssignLeaderAction.svelte';

	// Above the awaited query: a declaration that follows a top-level await is
	// async-gated, which would compile every `fields.X.as()` below into an async
	// derived. Pinned by `src/async-effect-shape.spec.ts`.
	const deactivateFields = deactivateGroup.fields;
	const reactivateFields = reactivateGroup.fields;

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffGroupPage(id));
	const group = $derived(data.group);
	const members = $derived(data.members);
	const isDeactivated = $derived(!!group.deletedAt);
</script>

<PageHeader title={group.name} subtitle={group.kind === 'committee' ? 'Committee' : 'Club'}>
	<StatusBadge status={isDeactivated ? 'deactivated' : 'active'} />
	<AssignLeaderAction groupId={id} hasLeader={!!group.ownerId} />
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

	<InfoCard title="Roster">
		{#if members.requested.length > 0}
			<!-- Applications lead, because they are the only rows here that are
			     waiting on somebody. A `by_application` group whose requests sat
			     mixed into the member list is exactly what the separate
			     `'requested'` status exists to prevent. -->
			<h3 class="text-sm font-semibold">Applications</h3>
			<Table>
				{#snippet head()}
					<th>Member</th>
					<th class="col-support whitespace-nowrap">Applied</th>
				{/snippet}
				{#each members.requested as m (m.id)}
					<tr>
						<td class="cell-primary"><EntityIdentity ref={m.member} /></td>
						<td class="col-support whitespace-nowrap">{formatDateShort(m.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}

		{#if members.active.length === 0 && members.pending.length === 0}
			<EmptyState description="No members yet" />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Member</th>
					<th class="w-px">Role</th>
					<th class="col-support">Position</th>
					<th class="col-extra whitespace-nowrap">Joined</th>
				{/snippet}
				{#each [...members.active, ...members.pending] as m (m.id)}
					<tr>
						<td class="w-px"><StatusBadge status={m.status} /></td>
						<td class="cell-primary"><EntityIdentity ref={m.member} /></td>
						<td class="w-px"><Badge variant="ghost">{m.role}</Badge></td>
						<td class="col-support">{m.position ?? '—'}</td>
						<td class="col-extra whitespace-nowrap">{formatDateShort(m.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<InfoCard title="Public page">
		<p class="text-sm">
			{#if group.visibility === 'public'}
				<a class="link link-primary" href={resolve(`/groups/${group.slug}`)}>/groups/{group.slug}</a
				>
			{:else}
				<span class="text-fg-2">
					Not listed publicly. Set visibility to Public above and it appears at
					<code class="text-xs">/groups/{group.slug}</code>.
				</span>
			{/if}
		</p>
	</InfoCard>

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
