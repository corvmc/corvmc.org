<script lang="ts" module>
	/** The bands a member may create events for: those they own or administer. */
	export function eventHosts<B extends { slug: string; name: string; role: string }>(
		bands: B[]
	): { slug: string; name: string }[] {
		return bands
			.filter((b) => b.role === 'owner' || b.role === 'admin')
			.map((b) => ({ slug: b.slug, name: b.name }));
	}
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import * as Form from '#lib/components/ui/Form/index.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createListing } from '#lib/remote/community-events.remote.js';
	import { createBandEventForm } from '#lib/remote/band-events.remote.js';

	/**
	 * The one create-event form for a member, from either panel (#3132). For picks
	 * who the event is for, and with it the remote: Me is a community listing, a band
	 * is that band's event, and each keeps its own guard. The fields are the same.
	 */
	let {
		hosts,
		initial,
		...rest
	}: {
		/** The bands the member may create events for: those they own or administer. */
		hosts: { slug: string; name: string }[];
		/** A band slug to open on, from that band's own page. */
		initial?: string;
		[key: string]: unknown;
	} = $props();

	// The page's band preselected once; the member's choice after that is theirs.
	// svelte-ignore state_referenced_locally
	let chosen = $state(hosts.some((h) => h.slug === initial) ? initial! : '');
	const host = $derived(hosts.find((h) => h.slug === chosen) ?? null);
	const remote = $derived(host ? createBandEventForm : createListing);
	const fields = $derived(remote.fields);

	const options = $derived([
		{ value: '', label: m.events_create_member_event_me_label() },
		...hosts.map((h) => ({ value: h.slug, label: h.name }))
	]);

	function created(result: unknown) {
		const eventId = (result as { eventId?: string } | undefined)?.eventId;
		if (!eventId) return;
		if (host) goto(resolve('/band/[slug]/events/[eventId]', { slug: host.slug, eventId }));
		else goto(resolve('/member/events/[id]/manage', { id: eventId }));
	}
</script>

<Action
	action={remote}
	label={m.events_create_member_event_label()}
	modalTitle={m.events_create_member_event_title()}
	maxWidth="max-w-md"
	submitLabel={m.events_create_member_event_label()}
	successToast={m.events_create_member_event_success_toast()}
	variant="primary"
	onsuccess={created}
	{...rest}
>
	{#snippet lead()}
		{#if hosts.length > 0}
			<Form.Field
				id="event-for"
				type="select"
				label={m.events_create_member_event_for_label()}
				bind:value={chosen}
				{options}
			/>
		{/if}
	{/snippet}
	{#snippet form()}
		<div class="space-y-4">
			{#if host}
				<input {...createBandEventForm.fields.slug.as('hidden', host.slug)} />
			{/if}
			<FormField
				field={fields.title}
				type="text"
				label={m.events_create_member_event_title_label()}
				placeholder={m.events_create_member_event_title_placeholder()}
				maxlength="200"
				required
			/>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField
					field={fields.eventDate}
					type="date"
					label={m.events_create_member_event_date_label()}
					required
				/>
				<FormField
					field={fields.eventStartTime}
					type="time"
					label={m.events_create_member_event_start_time_label()}
					required
				/>
			</div>
			<FormField
				field={fields.location}
				type="text"
				label={m.events_create_member_event_venue_label()}
				placeholder={m.events_create_member_event_venue_placeholder()}
				maxlength="500"
				required
			/>
			<p class="text-muted" data-testid="event-draft-note">
				{host
					? m.events_create_member_event_band_draft_text()
					: m.events_create_member_event_own_draft_text()}
			</p>
		</div>
	{/snippet}
</Action>
