<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
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
	import InviteMemberAction from '../InviteMemberAction.svelte';
	import MemberViews from '../MemberViews.svelte';

	type Status = 'pending' | 'accepted' | 'revoked' | '';
	let status = $state<Status>('pending');
	let page = $state(1);

	const result = $derived(getMemberInvites({ status: status || undefined, page }));
	const resendFields = resendMemberInviteForm.fields;
	const revokeFields = revokeMemberInviteForm.fields;

	const badges: Record<string, { label: string; variant: BadgeVariant }> = {
		pending: { label: m.staff_pending_label(), variant: 'info' },
		expired: { label: m.staff_members_invites_expired_label(), variant: 'warning' },
		accepted: { label: m.staff_joined_label(), variant: 'success' },
		revoked: { label: m.staff_members_invites_revoked_label(), variant: 'ghost' }
	};
</script>

<PageHeader title={m.staff_members_title()}>
	<MemberViews active="invites" />
</PageHeader>

<PageContent>
	<FilterBar
		activeCount={status === 'pending' ? 0 : 1}
		onclear={() => {
			status = 'pending';
			page = 1;
		}}
	>
		<Select
			size="sm"
			aria-label={m.staff_status_label()}
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value as Status;
				page = 1;
			}}
		>
			<option value="pending">{m.staff_pending_label()}</option>
			<option value="accepted">{m.staff_joined_label()}</option>
			<option value="revoked">{m.staff_members_invites_revoked_label()}</option>
			<option value="">{m.staff_all_statuses_label()}</option>
		</Select>
		{#snippet actions()}
			<InviteMemberAction />
		{/snippet}
	</FilterBar>

	<DataList {result} empty={m.staff_members_invites_empty_body()} onpage={(p) => (page = p)}>
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
</PageContent>
