<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import Alert from '../ui/Alert.svelte';
	import Button from '../ui/Button.svelte';
	import { Field } from '../ui/Form';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withHash } from '#lib/utils/with-query.js';
	import { publishEvent, getEventPublishBlockers } from '#lib/remote/events.remote.js';

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

	// Each gap is fixed in the Listing tab, which opens with no `tab` in the URL.
	const GAPS = {
		title: { anchor: 'listing-title', text: () => m.actions_publish_event_gap_title_text() },
		startsAt: { anchor: 'listing-date', text: () => m.actions_publish_event_gap_start_text() },
		description: {
			anchor: 'listing-description',
			text: () => m.actions_publish_event_gap_description_text()
		}
	};
	const gapHref = (gap: keyof typeof GAPS) =>
		withHash(resolve('/staff/events/[id]', { id: eventId }), GAPS[gap].anchor);
</script>

<Action
	action={publishEvent}
	label={m.actions_publish_label()}
	submitLabel={blockers.length > 0
		? m.actions_publish_event_publish_anyway_label()
		: m.actions_publish_label()}
	successToast={m.actions_published_toast()}
	data-testid="publish-event"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form({ close })}
		<input {...fields.id.as('hidden', eventId)} />
		{#if blockers.length > 0}
			<Alert type="warning">
				{m.actions_publish_event_not_ready_announce_body()}
				<ul class="mt-1 list-inside list-disc">
					{#each blockers as gap (gap)}
						<li>
							<a class="link" href={gapHref(gap)} onclick={close}>{GAPS[gap].text()}</a>
						</li>
					{/each}
				</ul>
			</Alert>
			<Button href={gapHref(blockers[0])} variant="primary" onclick={close}>
				{m.actions_publish_event_fill_them_in_label()}
			</Button>
			<!-- Warn, record, allow (#1787): the reason goes to the audit log. -->
			<p class="py-2 text-muted">
				{m.actions_publish_event_fix_these_first_if_can_text()}
			</p>
			<Field
				field={fields.reason}
				type="textarea"
				label={m.actions_publish_event_why_publish_now_label()}
			/>
		{:else}
			<p class="py-2">{m.actions_publish_event_publish_event_make_visible_public_text()}</p>
		{/if}
	{/snippet}
</Action>
