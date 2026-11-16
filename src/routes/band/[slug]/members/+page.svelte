<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import Form, { Field } from '#lib/components/ui/Form/index.js';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import YourMembership from './YourMembership.svelte';
	import EditMemberAction from './EditMemberAction.svelte';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		searchBandUsers as searchUsers,
		getBandMembersPage,
		inviteMember,
		removeMember,
		revokeInvitation,
		transferOwner,
		inviteByEmail,
		revokeEmailInvite
	} from '#lib/remote/bands.remote.js';
	import { getBandLayoutContext } from '../layout-context';

	// Above the awaited queries: a declaration after a top-level await is
	// async-gated, which would compile every `fields.X.as()` into an async
	// derived.
	const { fields: removeFields } = removeMember;
	const { fields: revokeFields } = revokeInvitation;
	const { fields: revokeEmailFields } = revokeEmailInvite;
	const { fields: inviteFields } = inviteMember;
	const { fields: transferFields } = transferOwner;
	const { fields: inviteEmailFields } = inviteByEmail;

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);

	const isAdmin = $derived(layout.userRole === 'admin');
	const isOwner = $derived(layout.userRole === 'owner');
	const canManage = $derived(isOwner || isAdmin);
	const isStaffOnly = $derived(layout.userRole === 'staff');

	// One query. The invites were loaded through an `$effect` into `$state` once, which sat
	// outside the layout's boundary and needed a hand-rolled re-fetch; then as a second query
	// gated on `canManage`, because `getBandEmailInvites` is admin-guarded and 403s a plain
	// member into the error boundary. Both are resolved server-side now, where the role is
	// already known — and one query is what this page can hold without kit 2.64 breaking it.
	const data = $derived(await getBandMembersPage(layout.band.id));
	const members = $derived(data.members);
	const emailInvites = $derived(data.emailInvites);

	const active = $derived(members.active);
	const pending = $derived(members.pending);

	/** The viewer's own row — it heads the page, so it isn't in the list below. */
	const me = $derived(active.find((m) => m.userId === layout.user.id) ?? null);
	const others = $derived(active.filter((m) => m.userId !== layout.user.id));
	const pendingEmailInvites = $derived(emailInvites.filter((i) => i.status === 'pending'));

	// Both repoint at the wrapper: nothing reads the constituents directly any more, so
	// refreshing them would repaint nothing. See `custom/refresh-the-composed-query`.
	function refreshMembers() {
		void getBandMembersPage(layout.band.id).refresh();
	}
	function refreshInvites() {
		void getBandMembersPage(layout.band.id).refresh();
	}

	// Invite form state
	let showInviteModal = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<{ id: string; name: string; email: string }[]>([]);
	let selectedUser = $state<{ id: string; name: string; email: string } | null>(null);
	let searching = $state(false);
	let showTransferModal = $state(false);
	let transferTarget = $state<{ userId: string; name: string } | null>(null);
	let inviteMode = $state<'search' | 'email'>('search');

	const looksLikeEmail = $derived(searchQuery.includes('@') && searchQuery.includes('.'));

	async function handleSearch() {
		if (searchQuery.length < 2) {
			searchResults = [];
			return;
		}
		searching = true;
		searchResults = await searchUsers({ bandId: layout.band.id, q: searchQuery }).catch(() => []);
		searching = false;
	}

	function selectUser(user: { id: string; name: string; email: string }) {
		selectedUser = user;
		searchQuery = user.name;
		searchResults = [];
	}

	const roleOptions = [
		{ value: 'member', label: msg.band_role_member_label() },
		{ value: 'admin', label: msg.band_admin_label() }
	];

	let searchTimeout: ReturnType<typeof setTimeout>;
	function onSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		searchQuery = value;
		selectedUser = null;
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(handleSearch, 300);
	}

	onDestroy(() => clearTimeout(searchTimeout));

	/** An owner transferring away is how they become able to leave. */
	function openTransferFromOwnMembership() {
		const first = others.find((m) => m.role !== 'owner');
		if (!first) {
			toast.error(msg.band_slug_members_there_nobody_else_band_transfer_toast());
			return;
		}
		transferTarget = { userId: first.userId, name: first.member.title };
		showTransferModal = true;
	}
</script>

<PageHeader width="2xl" title={msg.band_members_title()} subtitle={layout.band.name}>
	{#if canManage}
		<Button variant="default" size="sm" onclick={() => (showInviteModal = true)}>
			{msg.band_slug_members_invite_member_label()}
		</Button>
	{/if}
</PageHeader>
<PageContent width="2xl">
	<!-- The viewer's own membership first: their role, the two things only they
	     can set, and the way out. -->
	<YourMembership
		{me}
		bandName={layout.band.name}
		role={layout.userRole}
		bandId={layout.band.id}
		onchanged={refreshMembers}
		ontransfer={openTransferFromOwnMembership}
	/>

	{#if isStaffOnly}
		<Alert type="info" href={`/staff/groups/${layout.band.id}`}>
			{msg.band_slug_members_re_viewing_band_as_staff_body()}
		</Alert>
	{/if}

	<InfoCard
		title={me
			? msg.band_slug_members_other_members_title({ length: others.length })
			: msg.band_slug_members_members_title({ length: others.length })}
	>
		{#if others.length === 0}
			<EmptyState
				title={msg.band_slug_members_nobody_else_yet_title()}
				description={msg.band_slug_members_description_body()}
			/>
		{:else}
			<div class="grid grid-cols-1 gap-2">
				{#each others as member (member.id)}
					<Card tone="base-200">
						<CardBody row class="py-3">
							<EntityIdentity ref={member.member} size="md" />
							<div class="flex shrink-0 items-center gap-2">
								<!-- Exception-only, like every other marker in the registry: a
								     badge on every row marks nothing, and `member` is what most
								     of a roster is (#1050). -->
								{#if member.role !== 'member'}
									<StatusBadge status={member.role} />
								{/if}
								{#if canManage && member.role !== 'owner'}
									<EditMemberAction
										bandId={layout.band.id}
										memberId={member.id}
										memberName={member.member.title}
										role={member.role as 'admin' | 'member'}
										position={member.position}
										onchanged={refreshMembers}
									/>
									<Action
										action={removeMember.for(member.id)}
										label={msg.band_remove_label()}
										variant="ghost"
										size="xs"
										confirm={msg.band_slug_members_remove_from_body({
											title: member.member.title,
											name: layout.band.name
										})}
										successToast={msg.band_slug_members_member_removed_toast()}
										onsuccess={refreshMembers}
									>
										{#snippet form()}
											<input {...removeFields.bandId.as('hidden', layout.band.id)} />
											<input {...removeFields.memberId.as('hidden', member.id)} />
										{/snippet}
									</Action>
								{/if}
								{#if isOwner && member.role !== 'owner'}
									<Button
										variant="ghost"
										size="xs"
										onclick={() => {
											transferTarget = { userId: member.userId, name: member.member.title };
											showTransferModal = true;
										}}
									>
										{msg.band_slug_members_transfer_label()}
									</Button>
								{/if}
							</div>
						</CardBody>
					</Card>
				{/each}
			</div>
		{/if}
	</InfoCard>

	{#if pending.length > 0}
		<InfoCard title={msg.band_slug_members_pending_invitations_title({ length: pending.length })}>
			<div class="grid grid-cols-1 gap-2">
				{#each pending as invite (invite.id)}
					<Card tone="base-200">
						<CardBody row class="py-3">
							<EntityIdentity ref={invite.member} size="md">
								{#snippet subtitle()}
									{msg.band_slug_members_invited_as_body({
										role: invite.role
									})}{#if invite.position}
										&nbsp;&middot; {invite.position}{/if}
								{/snippet}
							</EntityIdentity>
							{#if canManage}
								<Action
									action={revokeInvitation.for(invite.id)}
									label={msg.band_slug_members_revoke_label()}
									variant="ghost"
									size="xs"
									confirm={msg.band_slug_members_revoke_invitation_body({
										title: invite.member.title
									})}
									successToast={msg.band_slug_members_invitation_revoked_toast()}
									onsuccess={refreshMembers}
								>
									{#snippet form()}
										<input {...revokeFields.bandId.as('hidden', layout.band.id)} />
										<input {...revokeFields.memberId.as('hidden', invite.id)} />
									{/snippet}
								</Action>
							{/if}
						</CardBody>
					</Card>
				{/each}
			</div>
		</InfoCard>
	{/if}

	{#if canManage && pendingEmailInvites.length > 0}
		<InfoCard
			title={msg.band_slug_members_awaiting_signup_title({ length: pendingEmailInvites.length })}
		>
			<div class="grid grid-cols-1 gap-2">
				{#each pendingEmailInvites as invite (invite.id)}
					<Card tone="base-200">
						<CardBody row class="py-3">
							<!-- `EntityIdentity`, like the pending section above it. Written by
							     hand this had already drifted: a `·` in a template string
							     against a `&middot;` in a snippet, and no media tile at all
							     (#1050). The ref has no id — nobody has signed up yet — so it
							     renders unlinked. -->
							<EntityIdentity
								ref={{
									type: 'member',
									id: null,
									title: invite.email,
									subtitle: null,
									pronouns: null,
									image: null,
									subtype: null
								}}
								size="md"
							>
								{#snippet subtitle()}
									{msg.band_slug_members_invited_as_body({
										role: invite.role
									})}{#if invite.position}
										&nbsp;&middot; {invite.position}{/if}{msg.band_slug_members_by_body({
										invitedByName: invite.invitedByName ?? ''
									})}
								{/snippet}
							</EntityIdentity>
							<div class="flex shrink-0 items-center gap-2">
								<Badge variant="warning">{msg.band_slug_members_awaiting_signup_2_label()}</Badge>
								<Action
									action={revokeEmailInvite}
									label={msg.band_slug_members_revoke_label()}
									variant="ghost"
									size="xs"
									confirm={msg.band_slug_members_revoke_invitation_2_body({ email: invite.email })}
									successToast={msg.band_slug_members_invite_revoked_toast()}
									onsuccess={refreshInvites}
								>
									{#snippet form()}
										<input {...revokeEmailFields.bandId.as('hidden', layout.band.id)} />
										<input {...revokeEmailFields.inviteId.as('hidden', invite.id)} />
									{/snippet}
								</Action>
							</div>
						</CardBody>
					</Card>
				{/each}
			</div>
		</InfoCard>
	{/if}
</PageContent>

<!-- Invite Member Modal -->
<Modal title={msg.band_slug_members_invite_member_title()} bind:open={showInviteModal}>
	<TabBar
		tabs={[
			{ key: 'search', label: msg.band_slug_members_search_members_label() },
			{ key: 'email', label: msg.band_slug_members_invite_by_email_label() }
		]}
		active={inviteMode}
		onchange={(key) => (inviteMode = key as 'search' | 'email')}
	/>

	{#if inviteMode === 'search'}
		<Form
			remote={inviteMember}
			onsuccess={() => {
				toast.success(msg.band_slug_members_invitation_sent_toast());
				showInviteModal = false;
				selectedUser = null;
				searchQuery = '';
				refreshMembers();
			}}
		>
			<div class="space-y-4">
				<Field label={msg.band_slug_members_search_by_name_email_label()} id="user-search">
					<input
						id="user-search"
						type="text"
						class="input w-full"
						placeholder={msg.band_slug_members_start_typing_name_email_placeholder()}
						value={searchQuery}
						oninput={onSearchInput}
						autocomplete="off"
					/>
					{#if selectedUser}
						<input {...inviteFields.bandId.as('hidden', layout.band.id)} />
						<input {...inviteFields.userId.as('hidden', selectedUser.id)} />
					{/if}

					{#if searchResults.length > 0 && !selectedUser}
						<ul class="menu mt-1 max-h-48 overflow-y-auto inset">
							{#each searchResults as result (result.id)}
								<li>
									<button type="button" onclick={() => selectUser(result)}>
										<span class="font-medium">{result.name}</span>
										<span class="text-subtle">{result.email}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					{#if searching}
						<p class="mt-1 text-subtle">{msg.band_slug_members_searching_text()}</p>
					{/if}
					{#if searchQuery.length >= 2 && searchResults.length === 0 && !searching && !selectedUser && looksLikeEmail}
						<p class="mt-1 text-subtle">
							{msg.band_slug_members_no_existing_members_found_text()}
							<button type="button" class="link" onclick={() => (inviteMode = 'email')}>
								{msg.band_slug_members_invite_by_email_2_label({ searchQuery })}
							</button>
						</p>
					{/if}
				</Field>

				<div class="grid grid-cols-2 gap-4">
					<Field
						label={msg.band_role_label()}
						field={inviteMember.fields.role}
						type="select"
						value="member"
						options={roleOptions}
					/>
					<Field
						label={msg.band_slug_members_position_label()}
						field={inviteMember.fields.position}
						type="text"
						placeholder={msg.band_slug_members_e_g_guitar_placeholder()}
					/>
				</div>

				<div class="flex justify-end pt-2">
					<SubmitButton
						label={msg.band_slug_members_send_invitation_label()}
						successLabel={msg.band_slug_members_sent_label()}
						variant="primary"
						disabled={!selectedUser}
					/>
				</div>
			</div>
		</Form>
	{:else}
		<Form
			remote={inviteByEmail}
			onsuccess={() => {
				toast.success(msg.band_slug_members_invitation_sent_toast());
				showInviteModal = false;
				searchQuery = '';
				refreshMembers();
				refreshInvites();
			}}
		>
			<div class="space-y-4">
				<input {...inviteEmailFields.bandId.as('hidden', layout.band.id)} />
				<p class="text-muted">
					{msg.band_slug_members_invite_someone_who_doesn_t_text()}
				</p>
				<Field
					field={inviteByEmail.fields.email}
					type="email"
					label={msg.band_slug_members_email_address_label()}
					value={looksLikeEmail ? searchQuery : ''}
				/>
				<div class="grid grid-cols-2 gap-4">
					<Field
						label={msg.band_role_label()}
						field={inviteByEmail.fields.role}
						type="select"
						value="member"
						options={roleOptions}
					/>
					<Field
						label={msg.band_slug_members_position_label()}
						field={inviteByEmail.fields.position}
						type="text"
						placeholder={msg.band_slug_members_e_g_guitar_placeholder()}
					/>
				</div>
				<div class="flex justify-end pt-2">
					<SubmitButton
						label={msg.band_slug_members_send_email_invite_label()}
						successLabel={msg.band_slug_members_sent_label()}
						variant="primary"
					/>
				</div>
			</div>
		</Form>
	{/if}
</Modal>

<!-- Transfer Ownership Modal -->
<Modal title={msg.band_slug_members_transfer_ownership_title()} bind:open={showTransferModal}>
	{#if transferTarget}
		<Form
			remote={transferOwner}
			onsuccess={() => {
				toast.success(msg.band_slug_members_ownership_transferred_toast());
				showTransferModal = false;
				refreshMembers();
			}}
		>
			<div class="space-y-4">
				<Alert type="warning">
					<ParaglideMessage
						message={msg.band_slug_members_about_transfer_ownership_will_demoted_body}
						inputs={{ name: layout.band.name, name2: transferTarget.name }}
						>{#snippet strong({ children })}<strong>{@render children?.()}</strong
							>{/snippet}</ParaglideMessage
					>
				</Alert>
				<input {...transferFields.bandId.as('hidden', layout.band.id)} />
				<input {...transferFields.newOwnerId.as('hidden', transferTarget.userId)} />
				<div class="flex justify-end pt-2">
					<SubmitButton
						label={msg.band_slug_members_transfer_ownership_label()}
						successLabel={msg.band_slug_members_transferred_label()}
						variant="warning"
					/>
				</div>
			</div>
		</Form>
	{/if}
</Modal>
