<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { removeBandEventPoster } from '$lib/remote/band-events.remote';

	// The band panel's own events live in `band-events.remote`, guarded by
	// `requireBandAdmin` and scoped to the band from the route. The
	// similarly-named staff/community wrappers next to this file post to
	// `events.remote` instead and would 403 here.
	const { fields } = removeBandEventPoster;

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
	action={removeBandEventPoster}
	label="Remove Poster"
	successToast="Removed"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<p class="py-2">Remove the poster from this event?</p>
	{/snippet}
</Action>
