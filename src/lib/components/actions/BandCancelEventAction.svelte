<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { cancelBandEventForm } from '$lib/remote/band-events.remote';

	// The band panel's own events live in `band-events.remote`, guarded by
	// `requireGroupRole({ slug }, 'admin')` and scoped to the band named by the
	// `slug` prop. The
	// similarly-named staff/community wrappers next to this file post to
	// `events.remote` instead and would 403 here.
	const { fields } = cancelBandEventForm;

	let {
		slug,
		eventId,
		variant = 'error',
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
	action={cancelBandEventForm}
	label="Cancel Event"
	successToast="Cancelled"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.slug.as('hidden', slug)} />
		<input {...fields.eventId.as('hidden', eventId)} />
		<p class="py-2">
			Cancel this event? The listing stays up marked as cancelled, and this cannot be undone.
		</p>
	{/snippet}
</Action>
