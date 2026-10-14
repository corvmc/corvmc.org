<script lang="ts">
	import type { RemoteFormField, RemoteFormFieldValue } from '@sveltejs/kit';
	import FormField from '$lib/components/ui/Form/FormField.svelte';

	/** A one-line add: the label is for screen readers, the placeholder is the prompt. */
	let {
		field,
		label,
		placeholder
	}: {
		field: RemoteFormField<RemoteFormFieldValue>;
		label: string;
		placeholder: string;
	} = $props();
</script>

<FormField {field} type="text" {label} {placeholder} class="inline-add" />

<style>
	:global(.inline-add) {
		padding-block: 0;
	}
	:global(.inline-add > .fieldset-legend) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
