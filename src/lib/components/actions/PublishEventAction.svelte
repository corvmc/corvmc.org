<script lang="ts">
	import Action from '../ui/Action.svelte';
	import Alert from '../ui/Alert.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { publishEvent, getEventPublishBlockers } from '$lib/remote/events.remote';

	const { fields } = publishEvent;

	let {
		eventId,
		variant = 'success',
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

	// Loaded up front, as in DeleteEventAction: the readiness answer belongs
	// before the click. It used to arrive only as a failed publish.
	const blockers = $derived(await getEventPublishBlockers(eventId));
</script>

<Action
	action={publishEvent}
	label="Publish"
	successToast="Published"
	canSubmit={blockers.length === 0}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', eventId)} />
		{#if blockers.length > 0}
			<Alert type="warning">
				Not ready to announce:
				<ul class="mt-1 list-inside list-disc">
					{#each blockers as blocker (blocker)}
						<li>{blocker}</li>
					{/each}
				</ul>
			</Alert>
			<p class="py-2 text-muted">Fix these and the event can go out.</p>
		{:else}
			<p class="py-2">Publish this event to make it visible to the public?</p>
		{/if}
	{/snippet}
</Action>
