<script lang="ts">
	/**
	 * Why an hour log needs a staff look. Advisory, never a block: refusing
	 * hours would not undo the work, only lose the record.
	 */
	import Badge from '$lib/components/ui/Badge.svelte';
	import { hourLogExceptionLabels, type HourLogException } from '$lib/config';

	let { exceptions }: { exceptions: HourLogException[] } = $props();
</script>

{#each exceptions as reason (reason)}
	<Badge variant="warning" size="xs" class="ml-1 align-middle">
		{hourLogExceptionLabels[reason]}
	</Badge>
{/each}
