<!--
	Test-only harness for ErrorToastBoundary's server-render behaviour. Lives as a real
	component (rather than inline in the spec) because `children` has to be a snippet
	containing an `await` expression, which can only be written in a `.svelte` file.
-->
<script lang="ts">
	import ErrorToastBoundary from './ErrorToastBoundary.svelte';

	let { showPending = true }: { showPending?: boolean } = $props();

	async function slowContent() {
		await Promise.resolve();
		return 'resolved content';
	}
</script>

<ErrorToastBoundary {showPending}>
	<p>{await slowContent()}</p>
</ErrorToastBoundary>
