<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { unpublishBandEvent } from '$lib/remote/band-events.remote';

	// The band panel's own events live in `band-events.remote`, guarded by
	// `requireBandAdmin` and scoped to the band from the route. The
	// similarly-named staff/community wrappers next to this file post to
	// `events.remote` instead and would 403 here.
	const { fields } = unpublishBandEvent;

	let {
		eventId,
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		eventId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={unpublishBandEvent}
	label="Unpublish"
	successToast="Unpublished"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<p class="py-2">
			Take this event back to a draft? It stops showing publicly until you publish it again.
		</p>
	{/snippet}
</Action>
