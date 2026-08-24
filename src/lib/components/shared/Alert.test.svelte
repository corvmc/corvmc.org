<!--
	Test harness for Alert.svelte. The bug this guards is about the *element* the
	component wraps its children in, so the children have to be real block-level
	markup — a snippet passed from a spec file can't express that.
-->
<script lang="ts">
	import Alert from './Alert.svelte';

	let { type = 'warning' }: { type?: 'info' | 'warning' | 'error' | 'success' } = $props();
</script>

<Alert {type}>
	<strong>Staff didn't publish this listing.</strong>
	<p class="mt-1">Fix it below and submit it again.</p>
	<ul class="mt-1 list-disc pl-5">
		<li>The date is in the past.</li>
	</ul>
</Alert>
