<!--
	Stand-in for `svelte-turnstile`'s widget: the hidden input it writes into the
	form, and nothing else. `siteKey` and `theme` are ignored.

	Writing the `$bindable` IS the output — `bind:reset` is how the real widget
	hands back its reset — so `no-useless-assignment` is off twice below. A
	fallback value would make the parent's `bind:reset={undefined}` a Svelte error.
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
