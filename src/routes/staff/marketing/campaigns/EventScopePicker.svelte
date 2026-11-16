<script lang="ts" module>
	import type { ReachVisibility } from '#lib/utils/audience-reach.js';

	export type EventOption = {
		id: string;
		title: string;
		when: string;
		visibility: ReachVisibility;
	};
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Which show this blast is about (#857). Sets `campaign.eventId`, the one
	 * thing that makes the "Event audience" built-in resolve to anybody
	 * — without it that audience matches nobody, which is the safe direction.
	 *
	 * `SearchSelect` rather than a `<select>`: the list is every live listing,
	 * and it queries on keystroke rather than with the page.
	 */
	import SearchSelect from '#lib/components/ui/Form/SearchSelect.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { searchEventsForCampaign } from '#lib/remote/events.remote.js';

	// Value-plus-callback rather than `bind:`: the picker is an output, and an
	// `$effect`-written `$bindable` is what `no-useless-assignment` catches.
	let {
		/** What the campaign is already scoped to: a draft's show, or the page it was started from. */
		initial = null,
		onchange
	}: {
		initial?: EventOption | null;
		onchange: (event: EventOption | null) => void;
	} = $props();

	const VISIBILITY: Record<ReachVisibility, (() => string) | null> = {
		public: null,
		members: m.events_visibility_members_label,
		group: m.events_visibility_group_label
	};

	// The date, and who may see the show when it is not everyone (#2773).
	function withDetail(e: EventOption) {
		const label = VISIBILITY[e.visibility];
		return { ...e, detail: label ? `${e.when} · ${label()}` : e.when };
	}

	// svelte-ignore state_referenced_locally
	let chosen = $state<(EventOption & { detail: string }) | null>(initial && withDetail(initial));

	function clear() {
		chosen = null;
		onchange(null);
	}
</script>

<div class="flex items-center gap-2">
	<div class="grow">
		<SearchSelect
			bind:value={chosen}
			onselect={(v) =>
				onchange(v ? { id: v.id, title: v.title, when: v.when, visibility: v.visibility } : null)}
			labelKey="title"
			descriptionKey="detail"
			placeholder={m.staff_search_shows_by_name_placeholder()}
			search={async (q) => (await searchEventsForCampaign(q)).map(withDetail)}
		/>
	</div>
	{#if chosen}
		<Button type="button" variant="ghost" size="sm" onclick={clear}
			>{m.staff_marketing_campaigns_event_scope_picker_clear_label()}</Button
		>
	{/if}
</div>
<!-- The show's people are counted on "Event audience" above, ticked or not (#2772). -->
{#if !chosen}
	<p class="mt-1 text-subtle">
		{m.staff_marketing_campaigns_event_scope_picker_optional_pick_o_text()}
	</p>
{/if}
