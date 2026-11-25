<script lang="ts">
	import type { RemoteFormField, RemoteFormFieldValue } from '$app/server';
	import FormField from './FormField.svelte';

	let {
		field,
		shape
	}: { field: RemoteFormField<RemoteFormFieldValue>; shape: 'spread' | 'field' } = $props();
</script>

{#if shape === 'spread'}
	<!-- The shape `field-as-spread.ssr.spec.ts` forbids, kept to prove why. -->
	<FormField {...field.as('number')} label="Share" value={30} />
{:else}
	<FormField {field} type="number" label="Share" value={30} />
{/if}
