<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/** Which show a sponsorship is credited on, and where. */
	import { Field } from '$lib/components/ui/Form';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { searchEventsForPlacement } from '$lib/remote/events.remote';
	import type { placeSponsorship } from '$lib/remote/sponsors.remote';

	type EventOption = { id: string; title: string; when: string };

	let { fields }: { fields: (typeof placeSponsorship)['fields'] } = $props();

	let chosen = $state<EventOption | null>(null);
</script>

<Field label={m.staff_show()} issues={fields.eventId.issues()}>
	<SearchSelect
		bind:value={chosen}
		field={fields.eventId}
		labelKey="title"
		descriptionKey="when"
		placeholder={m.staff_search_shows_by_name()}
		search={(q) => searchEventsForPlacement(q)}
	/>
</Field>
<Field
	field={fields.onEventPage}
	type="checkbox"
	label={m.staff_event_page()}
	value={true}
	checkboxLabel={m.staff_sponsors_id_placement_fields_credit_them_public_event()}
/>
<Field
	field={fields.inCampaign}
	type="checkbox"
	label={m.staff_email()}
	value={true}
	checkboxLabel={m.staff_sponsors_id_placement_fields_credit_them_email_campaig()}
/>
<p class="text-subtle">
	{m.staff_sponsors_id_placement_fields_shown_only_while_sponsors()}
</p>
