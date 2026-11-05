<!--
	Test harness for FormField: `bind:value` on a field-mode input, which a spec
	cannot observe through `render` props alone.
-->
<script lang="ts">
	import type { RemoteFormField, RemoteFormFieldValue } from '$app/server';
	import FormField from './FormField.svelte';

	let { field }: { field: RemoteFormField<RemoteFormFieldValue> } = $props();
	let value = $state('2026-11-03');
</script>

<FormField {field} type="date" label="Date" bind:value />
<output data-testid="bound">{value}</output>
