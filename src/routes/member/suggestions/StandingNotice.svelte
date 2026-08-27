<script lang="ts">
	import Alert from '$lib/components/ui/Alert.svelte';
	import { getMySuggestionStanding } from '$lib/remote/suggestions.remote';

	/**
	 * The "your posts go to staff first" notice, owning its own query.
	 *
	 * `getMySuggestionStanding` does not depend on the board's filters, so composing it into the
	 * board query would re-fetch it on every keystroke — and awaiting the pair on the page would
	 * suspend into the member layout's boundary, blanking the page each time. It loads here
	 * instead. Kit dedupes per request, so this and `CreateSuggestionAction` are one read.
	 */
	const standing = $derived(await getMySuggestionStanding());
</script>

{#if standing.status !== 'none'}
	<!-- Say this plainly. A member whose posts silently stopped appearing would
	     reasonably conclude the site was broken, or that they'd been shadowbanned. -->
	<Alert type="warning">
		<p>
			Your suggestions go to staff for a look before they appear on the board. This started after a
			report was upheld against one of your posts.
			{#if standing.reason}
				Staff's note: <span class="italic">{standing.reason}</span>
			{/if}
		</p>
	</Alert>
{/if}
