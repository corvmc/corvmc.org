<script lang="ts">
	/** Which show a sponsorship is credited on, and where. */
	import { Field } from '$lib/components/ui/Form';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { searchEvents } from '$lib/remote/events.remote';
	import type { placeSponsorship } from '$lib/remote/sponsors.remote';

	type EventOption = { id: string; title: string; when: string };

	let { fields }: { fields: (typeof placeSponsorship)['fields'] } = $props();

	let chosen = $state<EventOption | null>(null);
</script>

<Field label="Show" issues={fields.eventId.issues()}>
	<SearchSelect
		bind:value={chosen}
		field={fields.eventId}
		labelKey="title"
		descriptionKey="when"
		placeholder="Search shows by name…"
		search={(q) => searchEvents(q)}
	/>
</Field>
<Field
	field={fields.onEventPage}
	type="checkbox"
	label="Event page"
	value={true}
	checkboxLabel="Credit them on the public event page"
/>
<Field
	field={fields.inCampaign}
	type="checkbox"
	label="Email"
	value={true}
	checkboxLabel="Credit them in email campaigns about this show"
/>
<p class="text-subtle">
	Shown only while the sponsorship is active or ended. Placing it on the same show again changes
	where it is credited.
</p>
