<script lang="ts">
	/**
	 * Which show this blast is about (#857). Sets `campaign.eventId`, the one
	 * thing that makes the "This show's audience" built-in resolve to anybody
	 * — without it that audience matches nobody, which is the safe direction.
	 *
	 * `SearchSelect` rather than a `<select>`: the list is every live listing,
	 * and it queries on keystroke rather than with the page.
	 */
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { searchEvents } from '$lib/remote/events.remote';
	import { getEventAudienceCount } from '$lib/remote/marketing.remote';

	type EventOption = { id: string; title: string; when: string };

	// Value-plus-callback rather than `bind:`: the picker is an output, and an
	// `$effect`-written `$bindable` is what `no-useless-assignment` catches.
	let {
		/** What the campaign is already scoped to, when editing a draft. */
		initial = null,
		onchange
	}: { initial?: EventOption | null; onchange: (eventId: string) => void } = $props();

	// svelte-ignore state_referenced_locally
	let chosen = $state<EventOption | null>(initial);

	function clear() {
		chosen = null;
		onchange('');
	}

	// A promise consumed by `{#await}`, not an awaited declaration: awaiting in
	// the script would suspend the editor into the staff layout's boundary on
	// every keystroke of the search above.
	const count = $derived(chosen ? getEventAudienceCount(chosen.id) : null);
</script>

<div class="flex items-center gap-2">
	<div class="grow">
		<SearchSelect
			bind:value={chosen}
			onselect={(v) => onchange(v?.id ?? '')}
			labelKey="title"
			descriptionKey="when"
			placeholder="Search shows by name…"
			search={(q) => searchEvents(q)}
		/>
	</div>
	{#if chosen}
		<Button type="button" variant="ghost" size="sm" onclick={clear}>Clear</Button>
	{/if}
</div>
{#if count}
	{#await count then n}
		<p class="mt-1 text-subtle">
			“This show's audience” resolves to {n}
			{n === 1 ? 'person' : 'people'} — ticket holders and RSVPs, minus anyone who has opted out. Tick
			it above to send to them.
		</p>
	{/await}
{:else}
	<p class="mt-1 text-subtle">
		Optional. Pick one and “This show's audience” resolves to its ticket holders and RSVPs; leave it
		blank and that audience is empty.
	</p>
{/if}
