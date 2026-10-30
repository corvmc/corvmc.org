<!--
	Test harness for VolunteerPanel.svelte: `action` is a snippet, which a spec
	cannot pass through `render(Component, props)`.
-->
<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import VolunteerPanel from './VolunteerPanel.svelte';

	let { volunteer }: { volunteer: ComponentProps<typeof VolunteerPanel>['volunteer'] } = $props();
</script>

<VolunteerPanel {volunteer} open>
	{#snippet action()}
		<button type="button">Log Hours</button>
	{/snippet}
</VolunteerPanel>
