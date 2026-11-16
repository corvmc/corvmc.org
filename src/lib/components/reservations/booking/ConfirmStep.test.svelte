<!--
	Test harness for ConfirmStep: a two-step remote form whose first step holds
	the slot under the names kit gives it, `<key>/<module hash>/<export>`.
-->
<script lang="ts">
	import * as Form from '#lib/components/ui/Form/index.js';
	import type { RemoteForm } from '$app/server';
	import type { BookerType } from '#lib/config.js';
	import ConfirmStep from './ConfirmStep.svelte';

	let {
		remote,
		values,
		bookerType
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a mocked remote form
		remote: RemoteForm<any, any>;
		values: Record<string, string>;
		bookerType?: BookerType;
	} = $props();
</script>

<Form.Root {remote}>
	<Form.Step>
		{#each Object.entries(values) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		<Form.SubmitButton label="Book" />
	</Form.Step>
	<ConfirmStep {bookerType} />
	<!-- The payment step's place: with none, Continue turns into a submit mid-click. -->
	<Form.Step><span></span></Form.Step>
</Form.Root>
