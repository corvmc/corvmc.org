<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { groupKindLabels } from '$lib/config';
	import { getMemberInviteGroups, inviteMemberForm } from '$lib/remote/users.remote';

	const { fields } = inviteMemberForm;

	// Null for a caller without `user.invite`: one query answers both whether
	// to show the action and what it offers.
	const groups = $derived(await getMemberInviteGroups());

	function onsuccess(result?: unknown) {
		const r = result as
			| { kind: 'existing'; userId: string; name: string }
			| { kind: 'invited'; email: string }
			| undefined;
		if (r?.kind === 'existing') {
			const href = resolve('/staff/members/[id]', { id: r.userId });
			toast.info(`${r.name} already has an account`, {
				action: { label: 'Open', onClick: () => goto(href) }
			});
		} else if (r?.kind === 'invited') {
			toast.success(`Invitation sent to ${r.email}`);
		}
	}
</script>

{#if groups}
	<Action action={inviteMemberForm} label="Invite member" modalTitle="Invite member" {onsuccess}>
		{#snippet form()}
			<FormField field={fields.email} type="email" label="Email" required />
			<FormField field={fields.name} label="Name (optional)" />
			{#if groups.length > 0}
				<CheckboxGroup
					field={fields.groupIds}
					legend="Clubs and committees (optional)"
					description="They join these when their account is set up."
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
