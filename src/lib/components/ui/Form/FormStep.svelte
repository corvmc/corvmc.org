<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getFormContext } from './Form.svelte';

	let { children, valid = true }: { children: Snippet; valid?: boolean } = $props();

	const form = getFormContext()!;
	const index = form.registerStep();

	$effect(() => {
		form.setStepValid(index, valid);
	});
</script>

<div class:hidden={form.currentStep !== index}>
	{@render children()}
</div>
