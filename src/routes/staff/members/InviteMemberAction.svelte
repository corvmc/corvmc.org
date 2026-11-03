<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { groupKindLabels } from '$lib/terms';
	import { getMemberInviteGroups, inviteMemberForm } from '$lib/remote/users.remote';

	const { fields } = inviteMemberForm;

	// Null for a caller without `user.invite`: one query answers both whether
	// to show the action and what it offers.
	const groups = $derived(await getMemberInviteGroups());

	function onsuccess(result?: unknown) {
		const r = result as
			| { kind: 'existing'; userId: string; name: string }
			| { kind: 'pending' | 'invited'; email: string }
			| undefined;
		if (r?.kind === 'existing') {
			const href = resolve('/staff/members/[id]', { id: r.userId });
			toast.info(m.staff_members_invite_member_already_has_account({ name: r.name }), {
				action: { label: m.staff_open(), onClick: () => goto(href) }
			});
		} else if (r?.kind === 'pending') {
			const href = resolve('/staff/members/invites');
			toast.info(m.staff_members_invite_member_already_has_pending_invitation({ email: r.email }), {
				action: { label: m.staff_open(), onClick: () => goto(href) }
			});
		} else if (r?.kind === 'invited') {
			toast.success(m.staff_members_invite_member_invitation_sent({ email: r.email }));
		}
	}
</script>

{#if groups}
	<Action
		action={inviteMemberForm}
		label={m.staff_members_invite_member_invite_member()}
		modalTitle={m.staff_members_invite_member_invite_member()}
		{onsuccess}
	>
		{#snippet form()}
			<FormField field={fields.email} type="email" label={m.staff_email()} required />
			<FormField field={fields.name} label={m.staff_members_invite_member_name_optional()} />
			{#if groups.length > 0}
				<CheckboxGroup
					field={fields.groupIds}
					legend={m.staff_members_invite_member_legend()}
					description={m.staff_members_invite_member_description()}
					options={groups.map((g) => ({
						value: g.id,
						label: g.name,
						description: groupKindLabels[g.kind]
					}))}
				/>
			{/if}
		{/snippet}
	</Action>
{/if}
