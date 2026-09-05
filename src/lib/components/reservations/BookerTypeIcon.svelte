<script lang="ts">
	import { IconUser, IconCalendarEvent, IconMusic } from '@tabler/icons-svelte';
	import type { BookerType } from '$lib/config';

	let {
		type,
		size = 16,
		class: extraClass = ''
	}: {
		type: BookerType;
		size?: number;
		class?: string;
	} = $props();
</script>

{#if type === 'user'}
	<IconUser {size} class={extraClass} />
{:else if type === 'group'}
	<IconMusic {size} class={extraClass} />
{:else if type === 'event_listing'}
	<IconCalendarEvent {size} class={extraClass} />
{/if}
