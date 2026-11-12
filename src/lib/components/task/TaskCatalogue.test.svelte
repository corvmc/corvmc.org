<!--
	Test harness for TaskCatalogue.svelte: the row's icon-only Mark done needs a
	`Tooltip.Provider`, which the app mounts in `+layout.svelte`.
-->
<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import TaskCatalogue from './TaskCatalogue.svelte';

	let { projectId }: { projectId?: string } = $props();
</script>

<Tooltip.Provider>
	<TaskCatalogue {projectId} />
</Tooltip.Provider>
