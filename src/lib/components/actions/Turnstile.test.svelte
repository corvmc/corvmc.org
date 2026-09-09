<!--
	Stand-in for `svelte-turnstile`'s widget: the hidden input it writes into the
	form, and nothing else. The real one injects Cloudflare's challenge script.
	`siteKey` and `theme` are passed by the component under test and ignored here.

	Writing the `$bindable` IS this component's output — `bind:reset` is how
	svelte-turnstile hands the parent its reset — so `no-useless-assignment` is
	off twice below. A fallback value instead would make the parent's
	`bind:reset={undefined}` a Svelte error.
-->
<script lang="ts">
	let {
		responseFieldName = 'cf-turnstile-response',
		// eslint-disable-next-line no-useless-assignment
		reset = $bindable()
	}: {
		responseFieldName?: string;
		reset?: () => void;
	} = $props();

	// eslint-disable-next-line no-useless-assignment
	reset = () => {};
</script>

<input type="hidden" name={responseFieldName} value="" />
