<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { getAudienceOptions, getEventAudienceCount } from '#lib/remote/marketing.remote.js';
	import {
		audienceCount,
		audiencesBeyondVisibility,
		type ReachVisibility
	} from '#lib/utils/audience-reach.js';

	/**
	 * The audience checkboxes and their recipient total, owning the query behind them.
	 *
	 * `total` is bindable because the page needs the number outside this markup: the send handler
	 * puts it in a confirm dialog.
	 */
	let {
		selected = $bindable<string[]>([]),
		total = $bindable(0),
		event = null,
		tickEventAudience = false
	}: {
		selected?: string[];
		total?: number;
		/** The show the campaign is about: what "Event audience" counts, and who may see it. */
		event?: { id: string; visibility: ReachVisibility } | null;
		/** Tick "Event audience" on open: a campaign started from a show's page (#2776). */
		tickEventAudience?: boolean;
	} = $props();

	const audiences = $derived(await getAudienceOptions());

	// svelte-ignore state_referenced_locally
	if (tickEventAudience) {
		const id = audiences.find((a) => a.systemKey === 'event-interest')?.id;
		if (id && !selected.includes(id)) selected = [...selected, id];
	}

	// "Event audience" stores no members; its count is the chosen show's (#2772).
	const eventCount = $derived(event ? await getEventAudienceCount(event.id) : 0);
	const countOf = (a: (typeof audiences)[number]) => audienceCount(a, eventCount);

	const ticked = $derived(audiences.filter((a) => selected.includes(a.id)));
	const computed = $derived(ticked.reduce((sum, a) => sum + countOf(a), 0));

	// Warn, record, allow (#2773): the send goes ahead and the event's history records it.
	const beyond = $derived(event ? audiencesBeyondVisibility(event.visibility, ticked) : []);

	$effect(() => {
		total = computed;
	});

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((a) => a !== id) : [...selected, id];
	}
</script>

<div class="flex flex-wrap gap-2">
	{#each audiences as a (a.id)}
		<label
			class="label cursor-pointer gap-2 rounded-lg border px-3 py-1.5 {selected.includes(a.id)
				? 'border-primary bg-primary/10'
				: 'border-base-300'}"
		>
			<input
				type="checkbox"
				class="checkbox checkbox-sm checkbox-primary"
				checked={selected.includes(a.id)}
				onchange={() => toggle(a.id)}
			/>
			<span class="text-sm">{a.name}</span>
			{#if a.systemKey}
				<span class="badge badge-xs badge-info">{m.staff_built_label()}</span>
			{/if}
			<span class="text-subtle">({countOf(a)})</span>
		</label>
	{/each}
</div>
{#if selected.length > 0}
	<p class="mt-1 text-subtle">
		{m.staff_marketing_campaigns_audience_picker_recipients_before_text({ total: computed })}
	</p>
{/if}
{#if event && beyond.length > 0}
	<Alert type="warning" class="mt-2">
		{(event.visibility === 'group'
			? m.staff_marketing_campaigns_audience_picker_beyond_group_body
			: m.staff_marketing_campaigns_audience_picker_beyond_members_body)({
			names: beyond.map((a) => a.name).join(', ')
		})}
	</Alert>
{/if}
