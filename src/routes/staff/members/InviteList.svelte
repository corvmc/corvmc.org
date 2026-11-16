<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import DataList from '#lib/components/ui/DataList.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge, { type BadgeVariant } from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import {
		getMemberInvites,
		resendMemberInviteForm,
		revokeMemberInviteForm
	} from '#lib/remote/users.remote.js';
	import InviteMemberAction from './InviteMemberAction.svelte';
	import MemberRoleFilter from './MemberRoleFilter.svelte';
	import { memberViewQuery } from './views';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { urlState, oneOf, positiveInt } from '#lib/urlState.svelte.js';
	import { goto } from '$app/navigation';

	// `invite`, not `status`: the list's own status filter chose this view.
	const f = urlState(withQuery(resolve('staff/members'), memberViewQuery('invited')), {
		invite: oneOf(['pending', 'accepted', 'revoked', 'any'] as const, 'pending'),
		page: positiveInt(1)
	});
	type Invite = typeof f.invite;

	const result = $derived(
		getMemberInvites({ status: f.invite === 'any' ? undefined : f.invite, page: f.page })
	);
	const resendFields = resendMemberInviteForm.fields;
	const revokeFields = revokeMemberInviteForm.fields;

	const badges: Record<string, { label: string; variant: BadgeVariant }> = {
		pending: { label: m.staff_pending_label(), variant: 'info' },
		expired: { label: m.staff_members_invites_expired_label(), variant: 'warning' },
		accepted: { label: m.staff_joined_label(), variant: 'success' },
		revoked: { label: m.staff_members_invites_revoked_label(), variant: 'ghost' }
	};
</script>

<FilterBar
	activeCount={f.invite === 'pending' ? 0 : 1}
	onclear={() => {
		f.invite = 'pending';
		f.page = 1;
	}}
>
	<MemberRoleFilter view="invited" />
	<!-- The list's status filter: any other status is the member list again. -->
	<Select
		size="sm"
		aria-label={m.staff_status_label()}
		value="invited"
		onchange={(e: Event) =>
			goto(
				withQuery(
					resolve('staff/members'),
					`status=${(e.currentTarget as HTMLSelectElement).value}`
				)
			)}
	>
		<option value="active">{m.staff_active_label()}</option>
		<option value="deactivated">{m.staff_deactivated_label()}</option>
		<option value="invited">{m.staff_members_invites_invited_label()}</option>
		<option value="all">{m.staff_all_statuses_label()}</option>
	</Select>
	<Select
		size="sm"
		aria-label={m.staff_members_invite_state_label()}
		value={f.invite}
		onchange={(e: Event) => {
			f.invite = (e.currentTarget as HTMLSelectElement).value as Invite;
			f.page = 1;
		}}
	>
		<option value="pending">{m.staff_pending_label()}</option>
		<option value="accepted">{m.staff_joined_label()}</option>
		<option value="revoked">{m.staff_members_invites_revoked_label()}</option>
		<option value="any">{m.staff_all_statuses_label()}</option>
	</Select>
	{#snippet actions()}
		<InviteMemberAction />
	{/snippet}
</FilterBar>

<DataList {result} empty={m.staff_members_invites_empty_body()} onpage={(p) => (f.page = p)}>
	{#snippet children(invites)}
		<Table>
			{#snippet head()}
				<th>{m.staff_members_invites_invited_label()}</th>
				<th class="col-support">{m.staff_members_invites_invited_by_label()}</th>
				<th class="col-support">{m.staff_members_invites_sent_label()}</th>
				<th class="w-px">{m.staff_status_label()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
			{/snippet}
			{#each invites as inv (inv.id)}
				{@const badge = badges[inv.expired ? 'expired' : inv.status]}
				<tr>
					<td class="cell-primary">
						{inv.name ?? inv.email}
						{#if inv.name}<div class="text-muted text-xs">{inv.email}</div>{/if}
					</td>
					<td class="col-support">{inv.invitedByName ?? '—'}</td>
					<td class="col-support">{formatDateShortYear(inv.sentAt)}</td>
					<td class="w-px"><Badge variant={badge.variant}>{badge.label}</Badge></td>
					<td class="w-px whitespace-nowrap">
						{#if inv.status === 'pending'}
							<Action
								action={resendMemberInviteForm.for(inv.id)}
								label={m.staff_resend_label()}
								aria-label={m.staff_members_invites_resend_invitation_label({ email: inv.email })}
								variant="ghost"
								size="xs"
								confirm={m.staff_members_invites_send_invitation_again_body({ email: inv.email })}
								successToast={m.staff_members_invites_invitation_sent_toast()}
								onsuccess={() => result.refresh()}
							>
								{#snippet form()}
									<input {...resendFields.id.as('hidden', inv.id)} />
								{/snippet}
							</Action>
							<Action
								action={revokeMemberInviteForm.for(inv.id)}
								label={m.staff_revoke_label()}
								aria-label={m.staff_members_invites_revoke_invitation_label({ email: inv.email })}
								variant="ghost"
								size="xs"
								confirm={m.staff_members_invites_revoke_invitation_2_body({ email: inv.email })}
								successToast={m.staff_members_invites_invitation_revoked_toast()}
								onsuccess={() => result.refresh()}
							>
								{#snippet form()}
									<input {...revokeFields.id.as('hidden', inv.id)} />
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/snippet}
</DataList>
