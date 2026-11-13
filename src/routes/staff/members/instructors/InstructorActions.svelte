<script lang="ts">
	import type { InstructorStatus } from '#lib/config.js';
	import ReviewApplicationActions from './ReviewApplicationActions.svelte';
	import EndGrantActions from './EndGrantActions.svelte';
	import RestoreGrantAction from './RestoreGrantAction.svelte';
	import { staffActions } from './staff-actions';
	import type { InstructorListingView } from './listing';

	/** Every control a teacher's status allows, for the row and the record panel alike. */
	let {
		record,
		name
	}: {
		record: InstructorListingView & { id: string; userId: string; status: InstructorStatus };
		name: string;
	} = $props();

	const actions = $derived(staffActions(record.status));
</script>

<div class="flex w-max gap-2">
	{#if actions.includes('approve')}
		<ReviewApplicationActions id={record.id} {name} listing={record} />
	{/if}
	{#if actions.includes('resume')}
		<RestoreGrantAction userId={record.userId} {name} kind="resume" />
	{/if}
	{#if actions.includes('reinstate')}
		<RestoreGrantAction userId={record.userId} {name} kind="reinstate" />
	{/if}
	{#if actions.includes('retire')}
		<EndGrantActions id={record.id} {name} pause={actions.includes('pause')} />
	{/if}
</div>
