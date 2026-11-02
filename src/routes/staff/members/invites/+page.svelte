<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge, { type BadgeVariant } from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { formatDateShortYear } from '$lib/utils/format';
	import {
		getMemberInvites,
		resendMemberInviteForm,
		revokeMemberInviteForm
	} from '$lib/remote/users.remote';
	import InviteMemberAction from '../InviteMemberAction.svelte';
	import MemberViews from '../MemberViews.svelte';

	type Status = 'pending' | 'accepted' | 'revoked' | '';
	let status = $state<Status>('pending');
	let page = $state(1);

	const result = $derived(getMemberInvites({ status: status || undefined, page }));
	const resendFields = resendMemberInviteForm.fields;
	const revokeFields = revokeMemberInviteForm.fields;

	const badges: Record<string, { label: string; variant: BadgeVariant }> = {
		pending: { label: 'Pending', variant: 'info' },
		expired: { label: 'Expired', variant: 'warning' },
		accepted: { label: 'Joined', variant: 'success' },
		revoked: { label: 'Revoked', variant: 'ghost' }
	};
</script>

<PageHeader title="Members">
	<InviteMemberAction />
</PageHeader>

<PageContent>
	<MemberViews active="invites" />

	<FilterBar
		activeCount={status === 'pending' ? 0 : 1}
		onclear={() => {
			status = 'pending';
			page = 1;
		}}
	>
		<Select
			size="sm"
			aria-label="Status"
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value as Status;
				page = 1;
			}}
		>
			<option value="pending">Pending</option>
			<option value="accepted">Joined</option>
			<option value="revoked">Revoked</option>
			<option value="">All statuses</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No invitations" onpage={(p) => (page = p)}>
		{#snippet children(invites)}
			<Table>
				{#snippet head()}
					<th>Invited</th>
					<th class="col-support">Invited by</th>
					<th class="col-support">Sent</th>
					<th class="w-px">Status</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
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
									label="Resend"
									aria-label={`Resend the invitation to ${inv.email}`}
									variant="ghost"
									size="xs"
									confirm="Send the invitation to {inv.email} again?"
									successToast="Invitation sent"
									onsuccess={() => result.refresh()}
								>
									{#snippet form()}
										<input {...resendFields.id.as('hidden', inv.id)} />
									{/snippet}
								</Action>
								<Action
									action={revokeMemberInviteForm.for(inv.id)}
									label="Revoke"
									aria-label={`Revoke the invitation to ${inv.email}`}
									variant="ghost"
									size="xs"
									confirm="Revoke the invitation to {inv.email}?"
									successToast="Invitation revoked"
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
