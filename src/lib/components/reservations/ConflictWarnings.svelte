<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { errorMessage } from '$lib/error-message';
	import ConflictAlerts from './ConflictAlerts.svelte';

	/**
	 * The boundary has to enclose the component that awaits: an `await` in a
	 * component's own script reports to the boundary *around* that component,
	 * so a boundary in the same file never sees the check fail (#1356).
	 */
	let {
		hasBlockingConflict = $bindable(),
		hasAdvisories = $bindable(),
		...check
	}: ComponentProps<typeof ConflictAlerts> = $props();
</script>

<svelte:boundary>
	<ConflictAlerts {...check} bind:hasBlockingConflict bind:hasAdvisories />

	{#snippet pending()}
		<div class="flex items-center gap-2 py-1">
			<span class="loading loading-xs loading-spinner"></span>
			<span class="text-subtle">Checking conflicts...</span>
		</div>
	{/snippet}

	<!-- No `data-conflicts` here: the check never settled, so nothing may read it as clear. -->
	{#snippet failed(error, reset)}
		<Alert type="warning" {reset}>
			Could not check this time for conflicts: {errorMessage(error)}
		</Alert>
	{/snippet}
</svelte:boundary>
