<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { addLineupAct } from '#lib/remote/productions.remote.js';
	import { searchBillActs } from '#lib/remote/external-acts.remote.js';

	/**
	 * The body of the Add act dialog (#3272): search CMC bands and outside acts,
	 * or, with no match, save a new outside act or add a plain name. Its own
	 * component so the choice resets each time the dialog opens.
	 */
	let {
		eventId,
		onchoice
	}: {
		eventId: string;
		/** Whether an act is chosen, for the dialog's submit. */
		onchoice: (chosen: boolean) => void;
	} = $props();

	type Choice = { kind: 'band' | 'act' | 'new' | 'name'; name: string; id?: string };

	const fields = addLineupAct.fields;
	let query = $state('');
	let choice = $state<Choice | null>(null);

	const trimmed = $derived(query.trim());
	const matches = $derived(
		trimmed.length >= 2 ? await searchBillActs({ eventId, q: trimmed }) : []
	);

	function pick(next: Choice | null) {
		choice = next;
		onchoice(next !== null);
	}
</script>

<input {...fields.eventId.as('hidden', eventId)} />
<input {...fields.name.as('hidden', choice?.name ?? '')} />
<input {...fields.bandId.as('hidden', choice?.kind === 'band' ? (choice.id ?? '') : '')} />
<input {...fields.actId.as('hidden', choice?.kind === 'act' ? (choice.id ?? '') : '')} />
<input {...fields.newAct.as('checkbox')} checked={choice?.kind === 'new'} hidden />

{#if !choice}
	<label class="label" for="lineup-search"
		>{m.staff_events_id_production_lineup_search_label()}</label
	>
	<input
		id="lineup-search"
		type="search"
		class="input w-full"
		autocomplete="off"
		bind:value={query}
		onkeydown={(e) => {
			if (e.key === 'Enter') e.preventDefault();
		}}
	/>
	{#if trimmed.length >= 2}
		<ul class="menu mt-1 menu-sm rounded border border-base-300 bg-base-100 p-1">
			{#each matches as match (match.id)}
				<li>
					<button
						type="button"
						onclick={() =>
							pick({ kind: match.kind === 'act' ? 'act' : 'band', name: match.name, id: match.id })}
					>
						{match.name}
						<span class="badge badge-ghost badge-xs">
							{match.kind === 'act'
								? m.events_lineup_editor_outside_act_label()
								: m.events_lineup_editor_cmc_label()}
						</span>
					</button>
				</li>
			{/each}
			{#if matches.length === 0}
				<li>
					<button type="button" onclick={() => pick({ kind: 'new', name: trimmed })}>
						{m.staff_events_id_production_lineup_create_label({ name: trimmed })}
					</button>
				</li>
				<li>
					<button type="button" onclick={() => pick({ kind: 'name', name: trimmed })}>
						{m.staff_events_id_production_lineup_name_only_label({ name: trimmed })}
					</button>
				</li>
			{/if}
		</ul>
	{/if}
{:else}
	<div class="flex items-center justify-between gap-2">
		<span class="font-medium">{choice.name}</span>
		<Button type="button" variant="ghost" size="xs" onclick={() => pick(null)}>
			{m.staff_events_id_production_lineup_change_label()}
		</Button>
	</div>
	{#if choice.kind === 'new'}
		<FormField
			field={fields.hometown}
			type="text"
			label={m.staff_events_id_production_lineup_hometown_label()}
		/>
		<FormField
			field={fields.email}
			type="email"
			label={m.staff_events_id_production_lineup_contact_email_label()}
		/>
	{/if}
	<FormField
		field={fields.setLengthMinutes}
		type="number"
		label={m.staff_events_id_production_lineup_set_length_label()}
		value={30}
	/>
{/if}
