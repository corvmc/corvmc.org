<script lang="ts" module>
	import { grantRuleFor } from '$lib/config';

	/** Where a committee grant reaches, in a sentence. */
	export function committeeReach(cap: string): string {
		return grantRuleFor(cap)?.committee === 'owned'
			? 'On records this committee owns.'
			: 'Across the whole collective.';
	}
</script>

<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { grantableBy } from '$lib/config';
	import { setCommitteeGrants } from '$lib/remote/groups.remote';

	/** The control that edits what a committee's active members may do. */
	let {
		groupId,
		name,
		held,
		label = 'Edit',
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
	modalTitle="What {name} members may do"
	successToast="Grants saved"
	{onsuccess}
>
	{#snippet form()}
		<input type="hidden" name="groupId" value={groupId} />
		<p class="text-muted">
			Every active member of this committee holds these. Leaving the committee takes them away.
		</p>
		<CheckboxGroup field={instance.fields.capabilities} selected={held} {options} />
	{/snippet}
</Action>
