<!--
	Test harness for Modal.svelte: `children` is a snippet, which a spec cannot
	pass through `render(Component, props)`.
-->
<script lang="ts">
	import Modal from './Modal.svelte';

	let { open = true, title = 'Book a Session' }: { open?: boolean; title?: string } = $props();
</script>

<Modal {open} {title}>
	<p>Pick a time.</p>
	<button type="button">Continue</button>
</Modal>
