<script lang="ts" module>
	import { grantRuleFor } from '#lib/config.js';

	/** Where a committee grant reaches, in a sentence. */
	export function committeeReach(cap: string): string {
		return grantRuleFor(cap)?.committee === 'owned'
			? 'On records this committee owns.'
			: 'Across the whole collective.';
	}
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import CheckboxGroup from '#lib/components/ui/Form/CheckboxGroup.svelte';
	import { grantableBy } from '#lib/config.js';
	import { setCommitteeGrants } from '#lib/remote/groups.remote.js';

	/** The control that edits what a committee's active members may do. */
	let {
		groupId,
		name,
		held,
		label = m.groups_edit(),
		onsuccess
	}: {
		groupId: string;
		name: string;
		held: string[];
		label?: string;
		onsuccess?: () => void;
	} = $props();

	const options = grantableBy('committee').map((cap) => ({
		value: cap,
		label: grantRuleFor(cap)?.label ?? cap,
		description: committeeReach(cap)
	}));
	const instance = $derived(setCommitteeGrants.for(groupId));
</script>

<Action
	action={instance}
	{label}
	variant="ghost"
	size="sm"
	modalTitle={m.groups_committee_grants_modal_title({ name })}
	successToast={m.groups_committee_grants_success_toast()}
	{onsuccess}
>
	{#snippet form()}
		<input {...instance.fields.groupId.as('hidden', groupId)} />
		<p class="text-muted">
			{m.groups_committee_grants_every_active_member_committee_holds()}
		</p>
		<CheckboxGroup field={instance.fields.capabilities} selected={held} {options} />
	{/snippet}
</Action>
