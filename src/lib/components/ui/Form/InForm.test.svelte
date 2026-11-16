<!--
	Test harness: mounts one Form component inside a real `Form`, which
	SubmitButton and FormStep read their context from. Children travel in
	`with.children`, so a spec chooses the snippet the component receives.
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import Form from './Form.svelte';

	let {
		component: Inner,
		with: innerProps = {}
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Form component
		component: Component<any>;
		with?: Record<string, unknown>;
	} = $props();
</script>

<Form action={async () => {}}>
	<Inner {...innerProps} />
</Form>
