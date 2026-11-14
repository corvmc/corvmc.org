<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { getFormContext } from '#lib/components/ui/Form/Form.svelte';

	export type LineupChip = {
		name: string;
		bandId?: string;
		/** An outside act already on file, picked from the staff bill's search. */
		actId?: string;
		/** Absent on chips added in this session — the server decides. */
		status?: 'unlinked' | 'pending' | 'confirmed' | 'declined';
	};

	let {
		value = $bindable<LineupChip[]>([]),
		ownerBandId,
		readonly = false,
		search,
		field,
		hint = true
	}: {
		value?: LineupChip[];
		/** The remote form field the serialized bill posts as. Absent, nothing posts. */
		field?: { as: (type: 'hidden', value: string) => Record<string, unknown> };
		/**
		 * Show the bill without the means to change it. Drops the reorder and
		 * remove buttons, the typeahead, and — the part that matters — the hidden
		 * `lineup` input, so a viewer who cannot edit this event also cannot post
		 * a lineup for it.
		 */
		readonly?: boolean;
		/**
		 * The band doing the editing; its own slot can't be removed. Absent on a
		 * community listing, where nobody on the bill is the author — every act is
		 * a credit and every credit is removable.
		 */
		ownerBandId?: string;
		/**
		 * Band lookup, always supplied by the caller. It used to default to the
		 * band-panel query, but that query now takes the band it is searching on
		 * behalf of and this component has no business knowing one — so each
		 * caller closes over its own ref: the band panel over its slug, a
		 * community listing over its own `requireUser` version, since its author
		 * may not be in a band at all.
		 */
		search: (q: string) => Promise<Array<{ id: string; name: string; kind?: 'band' | 'act' }>>;
		/** The line under the box on how confirmation works. */
		hint?: boolean;
	} = $props();

	let query = $state('');

	// A chip added or moved with a button fires no input event, so the
	// enclosing form's unsaved-changes guard is told directly.
	const form = getFormContext();

	// Skipped entirely when read-only: there is no box to type in, and this is a
	// top-level await that would otherwise fire a query per keystroke.
	const matches = $derived(!readonly && query.trim().length >= 2 ? await search(query.trim()) : []);

	/** Suggestions minus anyone already on the bill. */
	const suggestions = $derived(
		matches.filter((m) => !value.some((v) => v.bandId === m.id || v.actId === m.id))
	);

	function add(chip: LineupChip) {
		const nameKey = chip.name.trim().toLowerCase();
		if (!nameKey) return;
		const dupe = chip.bandId
			? value.some((v) => v.bandId === chip.bandId)
			: chip.actId
				? value.some((v) => v.actId === chip.actId)
				: value.some((v) => v.name.trim().toLowerCase() === nameKey);
		if (dupe) return;

		value = [...value, { ...chip, name: chip.name.trim() }];
		form?.changed();
		query = '';
	}

	/** Enter on a non-match is the common case: most acts have no CMC account. */
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		if (query.trim()) add({ name: query });
	}

	function remove(i: number) {
		value = value.filter((_, j) => j !== i);
		form?.changed();
	}

	function move(i: number, delta: number) {
		const j = i + delta;
		if (j < 0 || j >= value.length) return;
		const next = [...value];
		[next[i], next[j]] = [next[j], next[i]];
		value = next;
		form?.changed();
	}

	function chipLabel(chip: LineupChip): string {
		if (chip.actId) return msg.events_lineup_editor_outside_act_label();
		if (!chip.bandId) return msg.events_lineup_editor_name_only_label();
		if (chip.status === 'confirmed') return 'confirmed';
		if (chip.status === 'declined') return 'declined';
		return 'awaiting reply';
	}

	function chipClass(chip: LineupChip): string {
		if (!chip.bandId) return 'badge-ghost';
		if (chip.status === 'confirmed') return 'badge-success';
		if (chip.status === 'declined') return 'badge-error';
		return 'badge-warning';
	}

	/** Serialized for the remote form; billingOrder is just the visual order. */
	const serialized = $derived(
		JSON.stringify(
			value.map((v, i) => ({ name: v.name, bandId: v.bandId, actId: v.actId, billingOrder: i }))
		)
	);
</script>

{#if field && !readonly}
	<input {...field.as('hidden', serialized)} />
{/if}

<div class="space-y-2">
	{#each value as chip, i (chip.name + i)}
		<div class="flex items-center gap-2 rounded border border-base-300 bg-base-100 px-3 py-2">
			<span class="w-6 text-xs tabular-nums opacity-50">{i === 0 ? '★' : i + 1}</span>
			<span class="flex-1 truncate text-sm font-medium">{chip.name}</span>
			<span class="badge badge-sm {chipClass(chip)}">{chipLabel(chip)}</span>
			{#if !readonly}
				<div class="flex gap-1">
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={i === 0}
						onclick={() => move(i, -1)}
						aria-label={msg.events_lineup_editor_move_up_label({ name: chip.name })}>↑</Button
					>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={i === value.length - 1}
						onclick={() => move(i, 1)}
						aria-label={msg.events_lineup_editor_move_down_label({ name: chip.name })}>↓</Button
					>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						class="text-error"
						disabled={!!ownerBandId && chip.bandId === ownerBandId}
						onclick={() => remove(i)}
						aria-label={msg.events_lineup_editor_remove_label({ name: chip.name })}>✕</Button
					>
				</div>
			{/if}
		</div>
	{/each}

	{#if readonly && value.length === 0}
		<p class="text-subtle">{msg.events_lineup_editor_no_other_bands_bill_text()}</p>
	{/if}

	{#if !readonly}
		<div>
			<input
				type="text"
				class="input w-full"
				placeholder={msg.events_lineup_editor_placeholder()}
				bind:value={query}
				{onkeydown}
			/>

			{#if suggestions.length > 0}
				<ul class="menu mt-1 menu-sm rounded border border-base-300 bg-base-100 p-1">
					{#each suggestions as b (b.id)}
						<li>
							<button
								type="button"
								onclick={() =>
									add(
										b.kind === 'act'
											? { name: b.name, actId: b.id }
											: { name: b.name, bandId: b.id }
									)}
							>
								{b.name}
								<span class="badge badge-ghost badge-xs"
									>{b.kind === 'act'
										? msg.events_lineup_editor_outside_act_label()
										: msg.events_lineup_editor_cmc_label()}</span
								>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if hint}
				<p class="mt-1 text-subtle">
					{msg.events_lineup_editor_anyone_can_go_bill_bands_text()}
				</p>
			{/if}
		</div>
	{/if}
</div>
