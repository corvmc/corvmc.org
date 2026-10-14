<script lang="ts">
	import type { RemoteFormField, RemoteFormFieldValue } from '@sveltejs/kit';
	import FormField from '$lib/components/ui/Form/FormField.svelte';

	/**
	 * A one-line add that reads as the next row of the list rather than a form
	 * field: no box until focus. The label is for screen readers.
	 */
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
	:global(.inline-add .input) {
		height: auto;
		min-height: 1.75rem;
		padding-inline: var(--inline-add-indent, 0) 0;
		border-color: transparent;
		background: transparent;
		box-shadow: none;
	}
	:global(.inline-add .input:focus-within) {
		outline: none;
		box-shadow: inset 0 -1px 0 var(--color-base-300);
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
