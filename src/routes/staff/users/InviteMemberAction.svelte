<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { groupKindLabels, hasCapability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import { getMemberInviteGroups, inviteMemberForm } from '$lib/remote/users.remote';

	const { fields } = inviteMemberForm;

	// The staff layout has already fetched its capabilities; the groups are
	// asked for only by somebody who may invite.
	const caps = $derived((await getStaffLayout()).capabilities);
	const canInvite = $derived(hasCapability(caps, 'user.invite'));
	const groups = $derived(canInvite ? await getMemberInviteGroups() : []);

	function onsuccess(result?: unknown) {
		const r = result as
			| { kind: 'existing'; userId: string; name: string }
			| { kind: 'invited'; email: string }
			| undefined;
		if (r?.kind === 'existing') {
			const href = resolve('/staff/users/[id]', { id: r.userId });
			toast.info(`${r.name} already has an account`, {
				action: { label: 'Open', onClick: () => goto(href) }
			});
		} else if (r?.kind === 'invited') {
			toast.success(`Invitation sent to ${r.email}`);
		}
	}
</script>

{#if canInvite}
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
