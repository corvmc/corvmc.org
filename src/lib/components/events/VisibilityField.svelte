<script lang="ts">
	import type { RemoteFormField, RemoteFormFieldValue } from '$app/server';
	import { m } from '#lib/paraglide/messages.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';

	/**
	 * Who may see a listing (#2662). "Group" is offered only where a group owns
	 * the listing, since it means that group's members.
	 */
	interface Props {
		field: RemoteFormField<RemoteFormFieldValue>;
		value: string;
		hasGroup: boolean;
	}

	let { field, value = $bindable(), hasGroup }: Props = $props();

	const options = $derived([
		{ value: 'public', label: m.events_visibility_public_label() },
		{ value: 'members', label: m.events_visibility_members_label() },
		...(hasGroup ? [{ value: 'group', label: m.events_visibility_group_label() }] : [])
	]);
</script>

<FormField
	{field}
	type="select"
	label={m.events_visibility_label()}
	bind:value
	{options}
	description={m.events_visibility_body()}
/>
