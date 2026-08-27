<script lang="ts">
	import ErrorToastBoundary from '$lib/components/ui/ErrorToastBoundary.svelte';

	let { children } = $props();
</script>

<!--
	`band/[slug]/+layout.svelte` awaits `getBandLayout` in its own instance script,
	which is OUTSIDE the boundary it wraps around `{@render children()}`. A 403 from
	that query therefore had nothing to catch it and the page rendered blank —
	no error UI at all (JAVASCRIPT-SVELTEKIT-3). This boundary sits one level up so
	the layout's own await is covered.

	`showPending={false}` keeps server rendering identical to before: a boundary with
	a pending snippet renders that snippet during SSR *instead of* awaiting its
	contents, which would have replaced the whole band shell with a spinner.
-->
<ErrorToastBoundary showPending={false}>
	{@render children()}
</ErrorToastBoundary>
