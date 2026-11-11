<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { publishBandEvent } from '#lib/remote/band-events.remote.js';

	// The band panel's own events live in `band-events.remote`, guarded by
	// `requireGroupRole({ slug }, 'admin')` and scoped to the band named by the
	// `slug` prop. The
	// similarly-named staff/community wrappers next to this file post to
	// `events.remote` instead and would 403 here.
	const { fields } = publishBandEvent;

	let {
		slug,
		eventId,
		variant = 'success',
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
	action={publishBandEvent}
	label={m.actions_publish_label()}
	successToast={m.actions_published_toast()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.slug.as('hidden', slug)} />
		<input {...fields.eventId.as('hidden', eventId)} />
		<p class="py-2">
			{m.actions_band_publish_event_publish_event_becomes_visible_pro_text()}
		</p>
	{/snippet}
</Action>
