<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { resolve } from '$app/paths';
	import { formatDateTimeShort, formatDateShort } from '$lib/utils/format';
	import { goto, invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import {
		getMemberGroup,
		leaveGroupForm,
		approveApplicationForm,
		declineApplicationForm
	} from '$lib/remote/groups.remote';
	import AnnouncementList from '$lib/components/groups/AnnouncementList.svelte';
	import MuteAnnouncementsAction from '$lib/components/groups/MuteAnnouncementsAction.svelte';
	import CreateSessionAction from '$lib/components/groups/CreateSessionAction.svelte';

	/**
	 * A club gets a page, not a panel.
	 *
	 * A panel is for work you return to — the band panel earns its frame because
	 * a band member keeps coming back to band-shaped work with money attached. A
	 * club is a subscription to a program: its value arrives by notification and
	 * on the calendar, and this page is where you come for the archive and the
	 * roster. See docs/specs/groups-spec.md § Interface.
	 *
	 * Announcements, Documents and Sessions are phases 7, 8 and 9. The tabs that
	 * exist now are the ones with something behind them.
	 *
	 * Above the awaited query: a declaration after a top-level await is
	 * async-gated, which would compile every `fields.X.as()` below into an async
	 * derived. Pinned by `src/async-effect-shape.spec.ts`.
	 */
	const leaveFields = leaveGroupForm.fields;
	const approveFields = approveApplicationForm.fields;
	const declineFields = declineApplicationForm.fields;

	type Tab = 'announcements' | 'overview' | 'sessions' | 'projects' | 'roster';

	let slug = $derived(page.params.slug!);
	const data = $derived(await getMemberGroup(slug));
	const group = $derived(data.group);
	const members = $derived(data.members);

	/**
	 * Announcements lead, per docs/specs/groups-spec.md § Interface: the archive
	 * is what you come back for, where Overview is what you read once. It is also
	 * the default tab, so `?tab=` names the other three and the bare URL is the
	 * post list.
	 */
	const defaultTab: Tab = 'announcements';
	const tab = $derived.by<Tab>(() => {
		const requested = page.url.searchParams.get('tab');
		if (requested === 'roster') return 'roster';
		if (requested === 'overview') return 'overview';
		if (requested === 'sessions') return 'sessions';
		if (requested === 'projects') return 'projects';
		if (requested === 'announcements') return 'announcements';
		return defaultTab;
	});
	const tabHref = (t: Tab) =>
		resolve(`/member/groups/${slug}${t === defaultTab ? '' : `?tab=${t}`}`);

	const kindLabel = $derived(group.kind === 'committee' ? 'Committee' : 'Club');
	// Staff read this page without being on the roster, so there is nothing for
	// them to leave.
	const isMember = $derived(data.role !== 'staff');

	/**
	 * A committee's own work, and the answer to giving one a window onto it
	 * without handing over the whole staff panel — the failure mode
	 * `admin-vs-staff-spec.md` was written about. Read-only: acting on a project
	 * from here waits on the capability work that spec designs.
	 */
	const projects = $derived(data.projects);
</script>

<PageHeader title={group.name} subtitle={kindLabel}>
	{#if data.canManage}
		<Badge variant="ghost">{data.role}</Badge>
	{/if}
	<!-- Beside Leave, which is the other thing a member does to a group they are
	     tired of hearing from. Null for staff, who have no roster row to mute. -->
	{#if data.notifyAnnouncements !== null}
		<MuteAnnouncementsAction
			groupId={group.id}
			groupName={group.name}
			muted={!data.notifyAnnouncements}
		/>
	{/if}
	{#if isMember}
		<Action
			action={leaveGroupForm}
			label="Leave"
			modalTitle="Leave group"
			submitLabel="Leave"
			confirm={group.joinPolicy === 'open'
				? `Leave ${group.name}? You can rejoin whenever you like.`
				: `Leave ${group.name}? You'll need to be invited back.`}
			successToast="You have left"
			variant="ghost"
			size="sm"
			onsuccess={() => goto(resolve('/member/groups'))}
			onfailure={() => toast.error('Failed to leave')}
		>
			{#snippet form()}
				<input {...leaveFields.groupId.as('hidden', group.id)} />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	<!-- URL-driven, so the tabs are real links and the router owns the state.
	     Not `replaceState()`, which updates neither `page.url` nor the router's
	     own state. -->
	<TabBar
		tabs={[
			{ key: 'overview', label: 'Overview', href: tabHref('overview') },
			...(projects.length > 0
				? [
						{
							key: 'projects',
							label: 'Projects',
							badge: projects.length,
							href: tabHref('projects')
						}
					]
				: []),
			{ key: 'roster', label: 'Roster', badge: members.active.length, href: tabHref('roster') }
		]}
		active={tab}
	/>

	{#if tab === 'announcements'}
		<AnnouncementList
			groupId={group.id}
			announcements={data.announcements}
			canManage={data.canManage}
		/>
	{:else if tab === 'projects'}
		<InfoCard title="Projects">
			{#if projects.length === 0}
				<EmptyState description="Nothing on the go right now." />
			{:else}
				<Table>
					{#snippet head()}
						<th>Project</th>
						<th>Status</th>
						<th>Dates</th>
					{/snippet}
					{#each projects as project (project.id)}
						<tr>
							<td class="cell-primary">{project.name}</td>
							<td><StatusBadge status={project.status} label /></td>
							<td>
								<!-- Dates, not date-times: a project runs for weeks, and a start time
								     of 6:55 PM is noise pretending to be precision. -->
								{#if project.startsAt}
									{formatDateShort(project.startsAt)}
									{project.endsAt ? ` – ${formatDateShort(project.endsAt)}` : ' onward'}
								{:else}
									—
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
	{:else if tab === 'sessions'}
		{#if data.canManage}
			<div class="flex justify-end">
				<CreateSessionAction groupId={group.id} />
			</div>
		{/if}
		<InfoCard title="Sessions">
			{#if data.sessions.length === 0}
				<EmptyState
					description={data.canManage
						? 'Nothing on the calendar. Put the first session up.'
						: 'Nothing on the calendar yet.'}
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th>When</th>
						<th>What</th>
						<th class="w-px"><span class="sr-only">Room</span></th>
						<th class="w-px">Status</th>
					{/snippet}
					{#each data.sessions as s (s.id)}
						<tr>
							<td class="whitespace-nowrap">{formatDateTimeShort(s.startsAt)}</td>
							<td class="cell-primary">
								<a class="link" href={resolve(`/events/${s.id}`)}>{s.title}</a>
							</td>
							<td class="w-px">
								<!-- The fact that separates a program's session from a listing
								     it merely advertises: this one holds the room, free. -->
								{#if s.reservesRoom}
									<Badge variant="ghost">Room held</Badge>
								{/if}
							</td>
							<td class="w-px"><StatusBadge status={s.status} /></td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
	{:else if tab === 'overview'}
		<InfoCard title="About">
			{#if group.bio}
				<p class="text-sm">{group.bio}</p>
			{:else}
				<EmptyState description="Nothing written about this program yet." />
			{/if}
		</InfoCard>

		{#if group.joinInstructions}
			<InfoCard title="How it works">
				<p class="text-sm">{group.joinInstructions}</p>
			</InfoCard>
		{/if}
	{:else}
		{#if data.canManage && members.requested.length > 0}
			<!-- Applications lead the roster under `by_application`: they are the
			     only rows here waiting on somebody. -->
			<InfoCard title="Requests">
				<Table>
					{#snippet head()}
						<th>Member</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}
					{#each members.requested as m (m.id)}
						<tr>
							<td class="cell-primary"><EntityIdentity ref={m.member} /></td>
							<td class="w-px">
								<div class="flex gap-2">
									<Action
										action={approveApplicationForm.for(m.id)}
										label="Approve"
										variant="primary"
										size="xs"
										successToast="Approved"
										onsuccess={() => invalidateAll()}
									>
										{#snippet form()}
											<input {...approveFields.slug.as('hidden', slug)} />
											<input {...approveFields.memberId.as('hidden', m.id)} />
										{/snippet}
									</Action>
									<Action
										action={declineApplicationForm.for(m.id)}
										label="Decline"
										variant="ghost"
										size="xs"
										successToast="Declined"
										onsuccess={() => invalidateAll()}
									>
										{#snippet form()}
											<input {...declineFields.slug.as('hidden', slug)} />
											<input {...declineFields.memberId.as('hidden', m.id)} />
										{/snippet}
									</Action>
								</div>
							</td>
						</tr>
					{/each}
				</Table>
			</InfoCard>
		{/if}

		<InfoCard title="Members">
			{#if members.active.length === 0 && members.pending.length === 0}
				<EmptyState description="No members yet." />
			{:else}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Member</th>
						<th class="w-px">Role</th>
						<th class="col-support">Position</th>
					{/snippet}
					{#each [...members.active, ...members.pending] as m (m.id)}
						<tr>
							<td class="w-px"><StatusBadge status={m.status} /></td>
							<!-- `position` and `alias`, falling back to the account name —
							     the ref already does that. -->
							<td class="cell-primary"><EntityIdentity ref={m.member} /></td>
							<td class="w-px"><Badge variant="ghost">{m.role}</Badge></td>
							<td class="col-support">{m.position ?? '—'}</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
	{/if}
</PageContent>
