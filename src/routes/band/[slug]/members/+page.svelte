<script lang="ts">
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import Form, { Field } from '$lib/components/shared/Form';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import YourMembership from './YourMembership.svelte';
	import EditMemberAction from './EditMemberAction.svelte';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		searchBandUsers as searchUsers,
		getBandMembersList,
		inviteMember,
		removeMember,
		revokeInvitation,
		transferOwner,
		getBandPlatformInvites as getPlatformInvites,
		inviteByEmail,
		revokePlatformInviteRemote
	} from '$lib/remote/bands.remote';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { page } from '$app/state';

	// Above the awaited queries: a declaration after a top-level await is
	// async-gated, which would compile every `fields.X.as()` into an async
	// derived.
	const { fields: removeFields } = removeMember;
	const { fields: revokeFields } = revokeInvitation;
	const { fields: revokePlatformFields } = revokePlatformInviteRemote;
	const { fields: inviteFields } = inviteMember;
	const { fields: transferFields } = transferOwner;

	let layout = $derived(await getBandLayout(page.params.slug!));

	const isAdmin = $derived(layout.userRole === 'admin');
	const isOwner = $derived(layout.userRole === 'owner');
	const canManage = $derived(isOwner || isAdmin);
	const isStaffOnly = $derived(layout.userRole === 'staff');

	let members = $derived(await getBandMembersList(layout.band.id));

	// Was loaded through an `$effect` into `$state`, which meant it sat outside
	// the layout's boundary and needed a hand-rolled re-fetch. An ordinary query
	// participates in both. Kept behind the role check because
	// `getBandPlatformInvites` is admin-guarded and would 403 a plain member into
	// the error boundary.
	let platformInvites = $derived(canManage ? await getPlatformInvites() : []);

	const active = $derived(members.active);
	const pending = $derived(members.pending);

	/** The viewer's own row — it heads the page, so it isn't in the list below. */
	const me = $derived(active.find((m) => m.userId === layout.user.id) ?? null);
	const others = $derived(active.filter((m) => m.userId !== layout.user.id));
	const pendingPlatform = $derived(platformInvites.filter((i) => i.status === 'pending'));

	function refreshMembers() {
		void getBandMembersList(layout.band.id).refresh();
	}
	function refreshInvites() {
		void getPlatformInvites().refresh();
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
		searchResults = await searchUsers(searchQuery).catch(() => []);
		searching = false;
	}

	function selectUser(user: { id: string; name: string; email: string }) {
		selectedUser = user;
		searchQuery = user.name;
		searchResults = [];
	}

	const roleOptions = [
		{ value: 'member', label: 'Member' },
		{ value: 'admin', label: 'Admin' }
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
			toast.error('There is nobody else in the band to transfer ownership to.');
			return;
		}
		transferTarget = { userId: first.userId, name: first.member.title };
		showTransferModal = true;
	}
</script>

<PageHeader title="Members" subtitle={layout.band.name}>
	{#if canManage}
		<Button variant="default" size="sm" onclick={() => (showInviteModal = true)}>
			Invite Member
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
		onchanged={refreshMembers}
		ontransfer={openTransferFromOwnMembership}
	/>

	{#if isStaffOnly}
		<Alert type="info" href={`/staff/bands/${layout.band.id}`}>
			You're viewing this band as staff. Roster changes go through staff tools.
		</Alert>
	{/if}

	<InfoCard title={me ? `Other members (${others.length})` : `Members (${others.length})`}>
		{#if others.length === 0}
			<EmptyState
				title="Nobody else yet"
				description="Invite the rest of the band so they can book sessions and manage events."
			/>
		{:else}
			<div class="grid grid-cols-1 gap-2">
				{#each others as member (member.id)}
					<Card tone="base-200">
						<CardBody row class="py-3">
							<EntityIdentity ref={member.member} size="md" />
							<div class="flex shrink-0 items-center gap-2">
								<StatusBadge status={member.role} />
								{#if canManage && member.role !== 'owner'}
									<EditMemberAction
										memberId={member.id}
										memberName={member.member.title}
										role={member.role as 'admin' | 'member'}
										position={member.position}
										onchanged={refreshMembers}
									/>
									<Action
										action={removeMember.for(member.id)}
										label="Remove"
										variant="ghost"
										size="xs"
										confirm="Remove {member.member.title} from {layout.band.name}?"
										successToast="Member removed"
										onsuccess={refreshMembers}
										onfailure={() => toast.error('Failed to remove')}
									>
										{#snippet form()}
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
										Transfer
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
		<InfoCard title={`Pending invitations (${pending.length})`}>
			<div class="grid grid-cols-1 gap-2">
				{#each pending as invite (invite.id)}
					<Card tone="base-200">
						<CardBody row class="py-3">
							<EntityIdentity ref={invite.member} size="md">
								{#snippet subtitle()}
									Invited as {invite.role}{#if invite.position}
										&middot; {invite.position}{/if}
								{/snippet}
							</EntityIdentity>
							{#if canManage}
								<Action
									action={revokeInvitation.for(invite.id)}
									label="Revoke"
									variant="ghost"
									size="xs"
									confirm="Revoke the invitation for {invite.member.title}?"
									successToast="Invitation revoked"
									onsuccess={refreshMembers}
									onfailure={() => toast.error('Failed to revoke')}
								>
									{#snippet form()}
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

	{#if canManage && pendingPlatform.length > 0}
		<InfoCard title={`Awaiting signup (${pendingPlatform.length})`}>
			<div class="grid grid-cols-1 gap-2">
				{#each pendingPlatform as invite (invite.id)}
					<Card tone="base-200">
						<CardBody row class="py-3">
							<div class="min-w-0">
								<p class="truncate font-medium">{invite.email}</p>
								<p class="text-subtle truncate">
									Invited as {invite.role}{invite.position ? ` · ${invite.position}` : ''} · by {invite.invitedByName}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<Badge variant="warning">awaiting signup</Badge>
								<Action
									action={revokePlatformInviteRemote}
									label="Revoke"
									variant="ghost"
									size="xs"
									confirm="Revoke the invitation for {invite.email}?"
									successToast="Invite revoked"
									onsuccess={refreshInvites}
									onfailure={() => toast.error('Failed to revoke')}
								>
									{#snippet form()}
										<input {...revokePlatformFields.inviteId.as('hidden', invite.id)} />
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
<Modal title="Invite Member" bind:open={showInviteModal}>
	<TabBar
		tabs={[
			{ key: 'search', label: 'Search members' },
			{ key: 'email', label: 'Invite by email' }
		]}
		active={inviteMode}
		onchange={(key) => (inviteMode = key as 'search' | 'email')}
	/>

	{#if inviteMode === 'search'}
		<Form
			remote={inviteMember}
			onsuccess={() => {
				toast.success('Invitation sent');
				showInviteModal = false;
				selectedUser = null;
				searchQuery = '';
				refreshMembers();
			}}
			onfailure={() => toast.error('Failed to send invitation')}
		>
			<div class="space-y-4">
				<Field label="Search by name or email" id="user-search">
					<input
						id="user-search"
						type="text"
						class="input w-full"
						placeholder="Start typing a name or email..."
						value={searchQuery}
						oninput={onSearchInput}
						autocomplete="off"
					/>
					{#if selectedUser}
						<input {...inviteFields.userId.as('hidden', selectedUser.id)} />
					{/if}

					{#if searchResults.length > 0 && !selectedUser}
						<ul class="menu mt-1 max-h-48 overflow-y-auto rounded-box bg-base-200">
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
						<p class="mt-1 text-subtle">Searching...</p>
					{/if}
					{#if searchQuery.length >= 2 && searchResults.length === 0 && !searching && !selectedUser && looksLikeEmail}
						<p class="mt-1 text-subtle">
							No existing members found.
							<button type="button" class="link" onclick={() => (inviteMode = 'email')}>
								Invite {searchQuery} by email?
							</button>
						</p>
					{/if}
				</Field>

				<div class="grid grid-cols-2 gap-4">
					<Field label="Role" name="role" type="select" value="member" options={roleOptions} />
					<Field label="Position" name="position" type="text" placeholder="e.g. Guitar" />
				</div>

				<div class="flex justify-end pt-2">
					<SubmitButton
						label="Send Invitation"
						successLabel="Sent"
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
				toast.success('Invitation sent');
				showInviteModal = false;
				searchQuery = '';
				refreshMembers();
				refreshInvites();
			}}
			onfailure={() => toast.error('Failed to send invitation')}
		>
			<div class="space-y-4">
				<p class="text-muted">
					Invite someone who doesn't have a CorvMC account yet. They'll receive an email with a
					signup link and be automatically added to your band.
				</p>
				<Field
					name="email"
					type="email"
					label="Email address"
					value={looksLikeEmail ? searchQuery : ''}
				/>
				<div class="grid grid-cols-2 gap-4">
					<Field label="Role" name="role" type="select" value="member" options={roleOptions} />
					<Field label="Position" name="position" type="text" placeholder="e.g. Guitar" />
				</div>
				<div class="flex justify-end pt-2">
					<SubmitButton label="Send Email Invite" successLabel="Sent" variant="primary" />
				</div>
			</div>
		</Form>
	{/if}
</Modal>

<!-- Transfer Ownership Modal -->
<Modal title="Transfer Ownership" bind:open={showTransferModal}>
	{#if transferTarget}
		<Form
			remote={transferOwner}
			onsuccess={() => {
				toast.success('Ownership transferred');
				showTransferModal = false;
				refreshMembers();
			}}
			onfailure={() => toast.error('Failed to transfer')}
		>
			<div class="space-y-4">
				<Alert type="warning">
					You are about to transfer ownership of <strong>{layout.band.name}</strong> to
					<strong>{transferTarget.name}</strong>. You will be demoted to admin. This cannot be
					undone without the new owner's consent.
				</Alert>
				<input {...transferFields.newOwnerId.as('hidden', transferTarget.userId)} />
				<div class="flex justify-end pt-2">
					<SubmitButton label="Transfer Ownership" successLabel="Transferred" variant="warning" />
				</div>
			</div>
		</Form>
	{/if}
</Modal>
