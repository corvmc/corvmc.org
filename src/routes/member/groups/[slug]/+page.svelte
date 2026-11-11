<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { resolve } from '$app/paths';
	import { formatDateTimeShort, formatDateShort } from '#lib/utils/format.js';
	import { goto } from '$app/navigation';
	import {
		getMemberGroup,
		leaveGroupForm,
		removeGroupMember,
		revokeGroupInvitation,
		revokeGroupEmailInvite
	} from '#lib/remote/groups.remote.js';
	import {
		cancelGroupSession,
		publishGroupSession,
		unpublishGroupSession
	} from '#lib/remote/group-events.remote.js';
	import AnnouncementList from '#lib/components/groups/AnnouncementList.svelte';
	import DocumentList from '#lib/components/groups/DocumentList.svelte';
	import MuteAnnouncementsAction from '#lib/components/groups/MuteAnnouncementsAction.svelte';
	import CreateSessionAction from '#lib/components/groups/CreateSessionAction.svelte';
	import InviteGroupMemberAction from '#lib/components/groups/InviteGroupMemberAction.svelte';
	import GroupMemberEditAction from '#lib/components/groups/GroupMemberEditAction.svelte';
	import GroupSelfEditAction from '#lib/components/groups/GroupSelfEditAction.svelte';
	import ApplicationsCard from '#lib/components/groups/ApplicationsCard.svelte';
	import EditSessionAction from '#lib/components/groups/EditSessionAction.svelte';
	import RepeatSessionAction from '#lib/components/groups/RepeatSessionAction.svelte';
	import ProjectStatusAction from './ProjectStatusAction.svelte';
	import ProjectDutyListAction from './ProjectDutyListAction.svelte';
	import CommitteeNumbers from './CommitteeNumbers.svelte';
	import ProjectWorkOrderAction from './ProjectWorkOrderAction.svelte';
	import ProjectEventPublishAction from './ProjectEventPublishAction.svelte';
	import NewShowAction from './NewShowAction.svelte';
	import CommitteeMarkets from './CommitteeMarkets.svelte';
	import CommitteeRecurringWork from './CommitteeRecurringWork.svelte';
	import CommitteeOpenItems from './CommitteeOpenItems.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug');

	/**
	 * A club gets a page, not a panel.
	 *
	 * A panel is for work you return to — the band panel earns its frame because
	 * a band member keeps coming back to band-shaped work with money attached. A
	 * club is a subscription to a program: its value arrives by notification and
	 * on the calendar, and this page is where you come for the archive and the
	 * roster. See docs/decisions/NNNN-a-club-gets-a-page-not-a-panel.md.
	 *
	 * Announcements, Documents and Sessions are phases 7, 8 and 9, and all three
	 * are now built.
	 *
	 * Above the awaited query: a declaration after a top-level await is
	 * async-gated, which would compile every `fields.X.as()` below into an async
	 * derived. Pinned by `src/async-effect-shape.spec.ts`.
	 */
	const leaveFields = leaveGroupForm.fields;
	const removeFields = removeGroupMember.fields;
	const revokeFields = revokeGroupInvitation.fields;
	const revokeEmailFields = revokeGroupEmailInvite.fields;
	const cancelSessionFields = cancelGroupSession.fields;
	const publishSessionFields = publishGroupSession.fields;
	const unpublishSessionFields = unpublishGroupSession.fields;

	type Tab =
		| 'announcements'
		| 'documents'
		| 'overview'
		| 'projects'
		| 'items'
		| 'numbers'
		| 'sessions'
		| 'roster';

	let slug = $derived(params.slug);
	const data = $derived(await getMemberGroup(slug));
	const group = $derived(data.group);
	const members = $derived(data.members);

	/**
	 * Announcements lead, per docs/decisions/NNNN-a-club-gets-a-page-not-a-panel.md: the archive
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
		if (requested === 'items') return 'items';
		if (requested === 'numbers') return 'numbers';
		if (requested === 'documents') return 'documents';
		if (requested === 'announcements') return 'announcements';
		return defaultTab;
	});
	const tabHref = (t: Tab) =>
		resolve(`member/groups/${slug}${t === defaultTab ? '' : `?tab=${t}`}`);

	const kindLabel = $derived(
		group.kind === 'committee'
			? msg.member_groups_slug_committee_body()
			: msg.member_groups_slug_club_body()
	);
	// Staff read this page without being on the roster, so there is nothing for
	// them to leave.
	const isMember = $derived(data.role !== 'staff');
	/** A roster member whose committee's grants carry `cap`; staff use the staff pages. */
	const may = (cap: string) => isMember && data.grants.includes(cap);

	/**
	 * A committee's own work, without handing over the whole staff panel. Any
	 * member can move a project's status; budget and burn are on the Numbers tab.
	 */
	const projects = $derived(data.projects);

	// The actions column exists for a chair, and for a plain member who has a
	// row of their own to edit. A staff non-member matches neither.
	const rosterActions = $derived(
		data.canManage || members.active.some((m) => m.userId === data.viewerId)
	);
	const pendingEmailInvites = $derived(data.emailInvites.filter((i) => i.status === 'pending'));

	// Repointed at the wrapper query: nothing reads the parts, so refreshing one
	// of those would repaint nothing. See `custom/refresh-the-composed-query`.
	const refreshRoster = () => void getMemberGroup(slug).refresh();
</script>

<PageHeader width="3xl" title={group.name} subtitle={kindLabel}>
	<!-- Your role, for anyone who has one. It was gated behind `canManage`, so
	     the list row told a plain member they were a member and the group's own
	     page did not (#1064). -->
	{#if isMember}
		<Badge variant="ghost">{data.role}</Badge>
	{/if}
	{#if data.canManage}
		<Button href={resolve(`member/groups/${slug}/edit`)} variant="ghost" size="sm"
			>{msg.member_edit_label()}</Button
		>
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
			label={msg.member_groups_slug_leave_label()}
			modalTitle={msg.member_groups_slug_leave_group_title()}
			submitLabel={msg.member_groups_slug_leave_label()}
			confirm={group.joinPolicy === 'open'
				? msg.member_groups_slug_leave_can_rejoin_whenever_like_body({ name: group.name })
				: msg.member_groups_slug_leave_ll_need_invited_back_body({ name: group.name })}
			successToast={msg.member_groups_slug_have_left_toast()}
			variant="ghost"
			size="sm"
			onsuccess={() => goto(resolve('member/groups'))}
		>
			{#snippet form()}
				<input {...leaveFields.groupId.as('hidden', group.id)} />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	<!-- URL-driven, so the tabs are real links and the router owns the state.
	     Not a shallow `goto`, which updates neither `page.url` nor the router's
	     own state. -->
	<TabBar
		tabs={[
			{
				key: 'announcements',
				label: msg.member_groups_slug_announcements_label(),
				href: tabHref('announcements')
			},
			{
				key: 'documents',
				label: msg.member_groups_slug_documents_label(),
				badge: data.files.length,
				href: tabHref('documents')
			},
			// Committee-only, and hidden while empty: a club can never own a project,
			// so the tab would be a permanent dead end on most of these pages.
			// A committee that opens shows keeps the tab while empty: its button is here.
			...(projects.length > 0 || may('production.create')
				? [
						{
							key: 'projects',
							label: msg.member_groups_slug_projects_label(),
							badge: projects.length,
							href: tabHref('projects')
						}
					]
				: []),
			// What the committee owes on its shows (#1701). Committee-only, and hidden
			// while there is nothing unfinished, as Projects is.
			...(group.kind === 'committee' && data.hasOpenItems
				? [{ key: 'items', label: msg.member_open_items_label(), href: tabHref('items') }]
				: []),
			// Its roster only (#1562); staff read the whole report on `/staff/reports`.
			...(group.kind === 'committee' && may('finance.read')
				? [
						{
							key: 'numbers',
							label: msg.member_groups_slug_numbers_label(),
							href: tabHref('numbers')
						}
					]
				: []),
			{
				key: 'sessions',
				label: msg.member_groups_slug_sessions_label(),
				href: tabHref('sessions')
			},
			{
				key: 'roster',
				label: msg.member_groups_slug_roster_label(),
				badge: members.active.length,
				href: tabHref('roster')
			},
			{ key: 'overview', label: msg.member_groups_slug_overview_label(), href: tabHref('overview') }
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
		<InfoCard title={msg.member_groups_slug_projects_title()}>
			{#snippet action()}
				{#if may('production.create')}
					<NewShowAction />
				{/if}
			{/snippet}
			{#if projects.length === 0}
				<EmptyState description={msg.member_groups_slug_nothing_go_right_now_body()} />
			{:else}
				<Table>
					{#snippet head()}
						<th>{msg.member_project_label()}</th>
						<th>{msg.member_status_label()}</th>
						<th>{msg.member_groups_slug_dates_label()}</th>
						{#if isMember}<th><span class="sr-only">{msg.member_actions_label()}</span></th>{/if}
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
									{project.endsAt
										? ` – ${formatDateShort(project.endsAt)}`
										: msg.member_groups_slug_onward_text()}
								{:else}
									—
								{/if}
							</td>
							{#if isMember}
								<td class="text-right">
									{#if may('project.manage') && data.projectDutyLists.length > 0}
										<ProjectDutyListAction {project} dutyLists={data.projectDutyLists} />
									{/if}
									{#if may('project.manage')}
										<ProjectStatusAction {project} />
									{/if}
									{#if may('volunteer.manageShifts') && data.workOrderRoles.length > 0}
										<ProjectWorkOrderAction {project} roles={data.workOrderRoles} />
									{/if}
								</td>
							{/if}
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
		{#if data.projectEvents.length > 0}
			<InfoCard title={msg.member_groups_slug_events_these_projects_title()}>
				<Table>
					{#snippet head()}
						<th>{msg.member_groups_slug_event_label()}</th>
						<th>{msg.member_project_label()}</th>
						<th>{msg.member_status_label()}</th>
						<th>{msg.member_when_label()}</th>
						{#if isMember}<th><span class="sr-only">{msg.member_actions_label()}</span></th>{/if}
					{/snippet}
					{#each data.projectEvents as event (event.id)}
						<tr>
							<td class="cell-primary">
								<!-- A show's console reads either half of it through the project. -->
								{#if event.productionId && (may('production.book') || may('production.run'))}
									<a class="link" href={resolve(`staff/events/${event.id}/production`)}
										>{event.title}</a
									>
								{:else}
									{event.title}
								{/if}
							</td>
							<td>{event.projectName}</td>
							<td><StatusBadge status={event.status} label /></td>
							<td>{formatDateTimeShort(event.startsAt)}</td>
							{#if isMember}
								<td class="text-right">
									{#if may('event.publish') && (event.status === 'draft' || event.status === 'pending_review')}
										<ProjectEventPublishAction {event} />
									{/if}
								</td>
							{/if}
						</tr>
					{/each}
				</Table>
			</InfoCard>
		{/if}
		{#if group.kind === 'committee' && may('event.manage')}
			<CommitteeMarkets groupId={group.id} {slug} />
		{/if}
		<CommitteeRecurringWork
			groupId={group.id}
			schedules={data.recurringWork}
			roles={data.workOrderRoles}
			canEdit={may('volunteer.manageRecurring')}
		/>
	{:else if tab === 'items' && group.kind === 'committee'}
		<CommitteeOpenItems {slug} />
	{:else if tab === 'numbers' && may('finance.read')}
		<CommitteeNumbers groupId={group.id} />
	{:else if tab === 'documents'}
		<DocumentList
			groupId={group.id}
			files={data.files}
			usage={data.documentUsage}
			canManage={data.canManage}
		/>
	{:else if tab === 'sessions'}
		{#if data.canManage}
			<div class="flex justify-end">
				<CreateSessionAction groupId={group.id} />
			</div>
		{/if}
		<InfoCard title={msg.member_groups_slug_sessions_title()}>
			{#if data.sessions.length === 0}
				<EmptyState
					description={data.canManage
						? msg.member_groups_slug_nothing_calendar_put_first_session_body()
						: msg.member_groups_slug_nothing_calendar_yet_body()}
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th>{msg.member_when_label()}</th>
						<th>{msg.member_groups_slug_what_label()}</th>
						<th class="w-px"><span class="sr-only">{msg.member_groups_slug_room_label()}</span></th>
						<th class="w-px">{msg.member_status_label()}</th>
						{#if data.canManage}
							<th class="w-px"><span class="sr-only">{msg.member_actions_label()}</span></th>
						{/if}
					{/snippet}
					{#each data.sessions as s (s.id)}
						<tr>
							<td class="whitespace-nowrap">{formatDateTimeShort(s.startsAt)}</td>
							<td class="cell-primary">
								<a class="link" href={resolve(`events/${s.id}`)}>{s.title}</a>
							</td>
							<td class="w-px">
								<!-- The fact that separates a program's session from a listing
								     it merely advertises: this one holds the room, free. -->
								{#if s.reservesRoom}
									<Badge variant="ghost" data-testid="room-held"
										>{msg.member_groups_slug_room_held_label()}</Badge
									>
								{/if}
							</td>
							<td class="w-px"><StatusBadge status={s.status} /></td>
							{#if data.canManage}
								<td class="w-px">
									{#if s.status !== 'cancelled'}
										<div class="flex w-max justify-end gap-2">
											<EditSessionAction groupId={group.id} session={s} onchanged={refreshRoster} />
											{#if !s.repeats}
												<RepeatSessionAction
													groupId={group.id}
													session={s}
													onchanged={refreshRoster}
												/>
											{/if}
											{#if s.status === 'published'}
												<Action
													action={unpublishGroupSession.for(s.id)}
													label={msg.member_groups_slug_unlist_label()}
													aria-label={msg.member_groups_slug_take_off_gig_guide_label({
														title: s.title
													})}
													modalTitle={msg.member_groups_slug_take_off_guide_title()}
													submitLabel={msg.member_groups_slug_unlist_label()}
													confirm={msg.member_groups_slug_take_off_public_gig_guide_body({
														title: s.title
													})}
													variant="ghost"
													size="xs"
													successToast={msg.member_groups_slug_taken_off_guide_toast()}
													onsuccess={refreshRoster}
												>
													{#snippet form()}
														<input {...unpublishSessionFields.groupId.as('hidden', group.id)} />
														<input {...unpublishSessionFields.eventId.as('hidden', s.id)} />
													{/snippet}
												</Action>
											{:else}
												<Action
													action={publishGroupSession.for(s.id)}
													label={msg.member_publish_label()}
													aria-label={msg.member_publish_2_label({ title: s.title })}
													modalTitle={msg.member_groups_slug_publish_session_title()}
													submitLabel={msg.member_publish_label()}
													confirm={msg.member_groups_slug_put_public_gig_guide_body({
														title: s.title
													})}
													variant="ghost"
													size="xs"
													successToast={msg.member_published_toast()}
													onsuccess={refreshRoster}
												>
													{#snippet form()}
														<input {...publishSessionFields.groupId.as('hidden', group.id)} />
														<input {...publishSessionFields.eventId.as('hidden', s.id)} />
													{/snippet}
												</Action>
											{/if}
											<Action
												action={cancelGroupSession.for(s.id)}
												label={msg.member_cancel_label()}
												aria-label={msg.member_groups_slug_cancel_label({ title: s.title })}
												modalTitle={msg.member_groups_slug_call_off_title()}
												submitLabel={msg.member_groups_slug_cancel_session_label()}
												confirm={s.reservesRoom
													? msg.member_groups_slug_cancel_room_holds_goes_back_body({
															title: s.title
														})
													: msg.member_groups_slug_cancel_2_body({ title: s.title })}
												variant="ghost"
												size="xs"
												successToast={msg.member_groups_slug_session_cancelled_toast()}
												onsuccess={refreshRoster}
											>
												{#snippet form()}
													<input {...cancelSessionFields.groupId.as('hidden', group.id)} />
													<input {...cancelSessionFields.eventId.as('hidden', s.id)} />
												{/snippet}
											</Action>
										</div>
									{/if}
								</td>
							{/if}
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
	{:else if tab === 'overview'}
		<InfoCard title={msg.member_about_title()}>
			{#if group.bio}
				<p class="text-sm">{group.bio}</p>
			{:else}
				<EmptyState
					description={data.canManage
						? msg.member_groups_slug_nothing_written_about_program_yet_body()
						: msg.member_groups_slug_nothing_written_about_program_yet_2_body()}
				>
					{#if data.canManage}
						<Button href={resolve(`member/groups/${slug}/edit`)} variant="primary" size="sm">
							{msg.member_groups_slug_write_label()}
						</Button>
					{/if}
				</EmptyState>
			{/if}
		</InfoCard>

		{#if group.joinInstructions}
			<InfoCard title={msg.member_how_works_title()}>
				<p class="text-sm">{group.joinInstructions}</p>
			</InfoCard>
		{/if}
	{:else}
		<!-- Above the roster: applications are the rows waiting on somebody. -->
		<ApplicationsCard
			{slug}
			kind={group.kind === 'committee' ? 'committee' : 'club'}
			applications={data.applications}
		/>

		{#if data.canManage}
			<div class="flex justify-end">
				<InviteGroupMemberAction {slug} groupName={group.name} onchanged={refreshRoster} />
			</div>
		{/if}

		<InfoCard title={msg.member_members_title()}>
			{#if members.active.length === 0 && members.pending.length === 0}
				<EmptyState
					description={data.canManage
						? msg.member_groups_slug_nobody_roster_yet_invite_first_body()
						: msg.member_groups_slug_no_members_yet_body()}
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">{msg.member_status_label()}</span></th>
						<th>{msg.member_member_label()}</th>
						<th class="w-px">{msg.member_role_label()}</th>
						<th>{msg.member_groups_slug_position_label()}</th>
						{#if rosterActions}
							<th class="w-px"><span class="sr-only">{msg.member_actions_label()}</span></th>
						{/if}
					{/snippet}
					{#each [...members.active, ...members.pending] as m (m.id)}
						<tr>
							<td class="w-px"><StatusBadge status={m.status} /></td>
							<!-- `position` and `alias`, falling back to the account name —
							     the ref already does that. -->
							<td class="cell-primary"><EntityIdentity ref={m.member} /></td>
							<td class="w-px"><Badge variant="ghost">{m.role}</Badge></td>
							<td>{m.position ?? '—'}</td>
							{#if rosterActions}
								<td class="w-px">
									<div class="flex w-max justify-end gap-2">
										{#if m.userId === data.viewerId && m.status === 'active'}
											<GroupSelfEditAction {slug} alias={m.alias} onchanged={refreshRoster} />
										{/if}
										{#if data.canManage && m.status === 'pending'}
											<Action
												action={revokeGroupInvitation.for(m.id)}
												label={msg.member_groups_slug_revoke_label()}
												aria-label={msg.member_groups_slug_revoke_invitation_label({
													title: m.member.title
												})}
												variant="ghost"
												size="xs"
												confirm={msg.member_groups_slug_revoke_invitation_3_body({
													title: m.member.title
												})}
												successToast={msg.member_groups_slug_invitation_revoked_toast()}
												onsuccess={refreshRoster}
											>
												{#snippet form()}
													<input {...revokeFields.slug.as('hidden', slug)} />
													<input {...revokeFields.memberId.as('hidden', m.id)} />
												{/snippet}
											</Action>
										{:else if data.canManage && m.role !== 'owner'}
											<GroupMemberEditAction
												{slug}
												memberId={m.id}
												memberName={m.member.title}
												role={m.role as 'admin' | 'member'}
												position={m.position}
												kindLabel={group.kind}
												onchanged={refreshRoster}
											/>
											<Action
												action={removeGroupMember.for(m.id)}
												label={msg.member_groups_slug_remove_label()}
												aria-label={msg.member_groups_slug_remove_2_label({
													title: m.member.title
												})}
												variant="ghost"
												size="xs"
												confirm={msg.member_groups_slug_remove_from_body({
													title: m.member.title,
													name: group.name
												})}
												successToast={msg.member_groups_slug_member_removed_toast()}
												onsuccess={refreshRoster}
											>
												{#snippet form()}
													<input {...removeFields.slug.as('hidden', slug)} />
													<input {...removeFields.memberId.as('hidden', m.id)} />
												{/snippet}
											</Action>
										{/if}
									</div>
								</td>
							{/if}
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>

		{#if data.canManage && pendingEmailInvites.length > 0}
			<!-- Invitations to an address rather than an account. They have no roster
			     row until the person signs up, so they cannot live in the table. -->
			<InfoCard title={msg.member_groups_slug_invited_by_email_title()}>
				<Table>
					{#snippet head()}
						<th>{msg.member_email_label()}</th>
						<th class="w-px">{msg.member_role_label()}</th>
						<th class="w-px"><span class="sr-only">{msg.member_actions_label()}</span></th>
					{/snippet}
					{#each pendingEmailInvites as inv (inv.id)}
						<tr>
							<td class="cell-primary">{inv.email}</td>
							<td class="w-px"><Badge variant="ghost">{inv.role}</Badge></td>
							<td class="w-px">
								<Action
									action={revokeGroupEmailInvite.for(inv.id)}
									label={msg.member_groups_slug_revoke_label()}
									aria-label={msg.member_groups_slug_revoke_invitation_2_label({
										email: inv.email
									})}
									variant="ghost"
									size="xs"
									confirm={msg.member_groups_slug_revoke_invitation_4_body({ email: inv.email })}
									successToast={msg.member_groups_slug_invitation_revoked_toast()}
									onsuccess={refreshRoster}
								>
									{#snippet form()}
										<input {...revokeEmailFields.slug.as('hidden', slug)} />
										<input {...revokeEmailFields.inviteId.as('hidden', inv.id)} />
									{/snippet}
								</Action>
							</td>
						</tr>
					{/each}
				</Table>
			</InfoCard>
		{/if}
	{/if}
</PageContent>
