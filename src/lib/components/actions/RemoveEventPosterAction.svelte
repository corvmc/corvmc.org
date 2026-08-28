<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { removeBandEventPoster } from '$lib/remote/band-events.remote';

	// The band panel's own events live in `band-events.remote`, guarded by
	// `requireGroupRole({ slug }, 'admin')` and scoped to the band named by the
	// `slug` prop. The
	// similarly-named staff/community wrappers next to this file post to
	// `events.remote` instead and would 403 here.
	const { fields } = removeBandEventPoster;

	let {
		slug,
		eventId,
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		/** The band this event belongs to — the ref the guard resolves. */
		slug: string;
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
		<input {...fields.slug.as('hidden', slug)} />
		<input {...fields.eventId.as('hidden', eventId)} />
		<p class="py-2">Remove the poster from this event?</p>
	{/snippet}
</Action>
