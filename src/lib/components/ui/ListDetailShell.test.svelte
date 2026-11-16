<!-- Test harness for ListDetailShell.svelte: snippets for both panes. -->
<script lang="ts">
	import ListDetailShell from './ListDetailShell.svelte';

	let { open, mode }: { open: boolean; mode?: 'panes' | 'pages' } = $props();
</script>

<ListDetailShell {open} {mode}>
	{#snippet list()}<p data-testid="list-body">list</p>{/snippet}
	<p data-testid="detail-body">detail</p>
</ListDetailShell>
