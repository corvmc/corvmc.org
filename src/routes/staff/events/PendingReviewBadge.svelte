<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import { getPendingSubmissionCount } from '$lib/remote/community-events.remote';

	/**
	 * The "Needs review" count, owning its own query.
	 *
	 * On the page it was a second remote query in flight beside the event list — the shape that
	 * stops a page rendering past kit 2.64. Composing the two instead would have been worse here:
	 * the count does not depend on the filters, so it would have re-fired on every keystroke, and
	 * awaiting the pair in the script would suspend the page inside the staff layout's boundary,
	 * blanking it each time. `DataList` exists to avoid exactly that.
	 */
	const count = $derived(await getPendingSubmissionCount());
</script>

{#if count}
	<Badge class="ml-1">{count}</Badge>
{/if}
