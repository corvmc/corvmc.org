<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import YourMembership from './YourMembership.svelte';
	import EditMemberAction from './EditMemberAction.svelte';
	import EditMyMembershipAction from './EditMyMembershipAction.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import InviteMembersModal from './InviteMembersModal.svelte';
	import TransferOwnershipModal from './TransferOwnershipModal.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getBandMembersPage,
		removeMember,
		revokeInvitation,
		revokeEmailInvite,
		leave
	} from '#lib/remote/bands.remote.js';
	import { getBandLayoutContext } from '../layout-context';

	// Above the awaited queries: a declaration after a top-level await is
	// async-gated, which would compile every `fields.X.as()` into an async
	// derived.
	const { fields: removeFields } = removeMember;
	const { fields: revokeFields } = revokeInvitation;
	const { fields: revokeEmailFields } = revokeEmailInvite;
	const { fields: leaveFields } = leave;

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

	/** The viewer's own row, marked in the roster and the one their own edit and leave sit on. */
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

	let showInviteModal = $state(false);
	let showTransferModal = $state(false);
	let transferTarget = $state<string | null>(null);
	const transferCandidates = $derived(
		others
			.filter((m) => m.role !== 'owner')
			.map((m) => ({ userId: m.userId, name: m.member.title }))
	);

	/** An owner transferring away is how they become able to leave. */
	function openTransferFromOwnMembership() {
		if (transferCandidates.length === 0) {
			toast.error(msg.band_slug_members_there_nobody_else_band_transfer_toast());
			return;
		}
		transferTarget = null;
		showTransferModal = true;
	}
</script>

<PageHeader width="2xl" title={msg.band_members_title()} subtitle={layout.band.name}>
	{#if canManage}
		<Button variant="default" size="sm" onclick={() => (showInviteModal = true)}>
			{msg.band_slug_members_invite_members_label()}
		</Button>
	{/if}
</PageHeader>
<PageContent width="2xl">
	{#if isStaffOnly}
		<Alert type="info" href={`/staff/bands/${layout.band.id}`}>
			{msg.band_slug_members_re_viewing_band_as_staff_body()}
		</Alert>
	{/if}

	<!-- One roster, the viewer included: invites still waiting lead while any
	     exist, then everyone in the band. The viewer's own edit and leave sit on
	     their row. -->
	<InfoCard title={msg.band_slug_members_members_title({ length: active.length })}>
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
						<div class="flex shrink-0 items-center gap-2">
							<Badge variant="warning">{msg.band_slug_members_pending_label()}</Badge>
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
						</div>
					</CardBody>
				</Card>
			{/each}

			{#if canManage}
				{#each pendingEmailInvites as invite (invite.id)}
					<Card tone="base-200">
						<CardBody row class="py-3">
							<!-- The ref has no id — nobody has signed up yet — so it renders
							     unlinked. -->
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
								<Badge variant="warning">{msg.band_slug_members_pending_label()}</Badge>
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
			{/if}

			{#each active as member (member.id)}
				{@const isMe = member.userId === layout.user.id}
				<Card tone="base-200">
					<CardBody row class="py-3">
						<!-- The subline is the member's instrument, from `getMembers`. -->
						<EntityIdentity ref={member.member} size="md" />
						<div class="flex shrink-0 items-center gap-2">
							{#if isMe}
								<Badge variant="neutral">{msg.band_slug_members_you_label()}</Badge>
							{/if}
							<!-- Exception-only, like every other marker in the registry: a
							     badge on every row marks nothing, and `member` is what most
							     of a roster is (#1050). -->
							{#if member.role !== 'member'}
								<StatusBadge status={member.role} />
							{/if}
							{#if isMe}
								<EditMyMembershipAction
									bandId={layout.band.id}
									name={member.member.title}
									alias={member.alias}
									position={member.position}
									onchanged={refreshMembers}
								/>
								{#if member.role !== 'owner'}
									<!-- `confirm` and a `form` snippet together: Action renders the
									     confirm copy as a lead-in above the fields. -->
									<Action
										action={leave}
										label={msg.band_slug_members_your_membership_leave_band_label()}
										variant="ghost"
										size="xs"
										modalTitle={msg.band_slug_members_your_membership_leave_band_title()}
										submitLabel={msg.band_slug_members_your_membership_leave_band_label()}
										confirm={msg.band_slug_members_your_membership_confirm_body({
											bandName: layout.band.name
										})}
										successToast={msg.band_slug_members_your_membership_have_left_band_toast()}
										onsuccess={() => goto(resolve('member/bands'))}
									>
										{#snippet form()}
											<input {...leaveFields.bandId.as('hidden', layout.band.id)} />
										{/snippet}
									</Action>
								{/if}
							{/if}
							{#if !isMe && canManage && member.role !== 'owner'}
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
							{#if !isMe && isOwner && member.role !== 'owner'}
								<Button
									variant="ghost"
									size="xs"
									onclick={() => {
										transferTarget = member.userId;
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
	</InfoCard>

	<YourMembership
		{me}
		bandName={layout.band.name}
		role={layout.userRole}
		ontransfer={openTransferFromOwnMembership}
	/>
</PageContent>

<InviteMembersModal
	bind:open={showInviteModal}
	bandId={layout.band.id}
	onsent={() => {
		refreshMembers();
		refreshInvites();
	}}
/>

<TransferOwnershipModal
	bind:open={showTransferModal}
	bandId={layout.band.id}
	bandName={layout.band.name}
	candidates={transferCandidates}
	selectedId={transferTarget}
	onsuccess={refreshMembers}
/>
