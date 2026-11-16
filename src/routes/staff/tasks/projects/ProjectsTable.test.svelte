<!--
	Test harness: `@container` is what PageContent provides on the real page,
	and Table's column packing is container-queried against it.
-->
<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ProjectsTable from './ProjectsTable.svelte';

	let { width, ...rest }: { width: number } & ComponentProps<typeof ProjectsTable> = $props();
</script>

<div class="@container" style="width: {width}px">
	<ProjectsTable {...rest} />
</div>
