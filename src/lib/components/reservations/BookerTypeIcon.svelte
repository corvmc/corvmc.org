<script lang="ts">
	import { IconUser, IconCalendarEvent, IconMusic } from '@tabler/icons-svelte';

	let {
		type,
		size = 16,
		class: extraClass = ''
	}: {
		type: string;
		size?: number;
		class?: string;
	} = $props();
</script>

{#if type === 'user'}
	<IconUser {size} class={extraClass} />
{:else if type === 'band'}
	<IconMusic {size} class={extraClass} />
{:else if type === 'event'}
	<IconCalendarEvent {size} class={extraClass} />
{/if}
