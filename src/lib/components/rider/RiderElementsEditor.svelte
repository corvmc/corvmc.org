<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import {
		riderElementKindLabels,
		riderElementKindOptions,
		riderInputSourceLabels,
		riderInputSourceOptions,
		riderProvidedByLabels,
		riderProvidedByOptions,
		riderStandTypeLabels,
		riderStandTypeOptions,
		RIDER_MAX_ELEMENTS,
		RIDER_MAX_INPUTS_PER_ELEMENT
	} from '#lib/config.js';
	import type { RiderElementRowState } from '#lib/types/rider.js';
	import type { RemoteFormField, RemoteFormFieldValue } from '@sveltejs/kit';
	import { safeFieldPrefix } from './field-names';
	import { IconPlus, IconTrash, IconChevronUp, IconChevronDown } from '@tabler/icons-svelte';
	import type { Snippet } from 'svelte';

	/**
	 * One person's corner of a rider: the gear they bring and the channels it
	 * needs.
	 *
	 * Repeated rows serialized into a single hidden JSON field — the shape
	 * `LineupEditor` established and `IntakeLines` extended to nested rows. A
	 * remote form's `FormData` cannot express an array of objects, and a request
	 * per row is a round-trip explosion.
	 *
	 * **Nothing here posts a position.** The server re-derives `sortOrder` from
	 * array order, and the band's channel numbering comes from each item's
	 * *kind*, not from this list — so moving your amp up cannot renumber the
	 * drummer's kit. Reordering here only breaks ties between your own items of
	 * the same kind.
	 */
	let {
		elements = $bindable(),
		roster,
		field,
		idPrefix = 'el',
		readonly = false,
		action
	}: {
		elements: RiderElementRowState[];
		/**
		 * The corner's submit button. It belongs on the same line as "Add
		 * something to the stage" — rendered by the parent below the editor it sat
		 * alone on a second row with ~580px of nothing between them (#1230).
		 */
		action?: Snippet;
		/** Whose monitor mix an input can feed. */
		roster: { userId: string; name: string }[];
		/**
		 * The remote form's own `elements` field.
		 *
		 * Taken from the form rather than emitted as `name="elements"`: a remote
		 * form encodes its field names, so a child component's plain `name` never
		 * reaches it and the field arrives as `undefined` with nothing on screen
		 * to show for it. The editor-state inputs below carry ids, not names: they
		 * are meant not to arrive.
		 */
		field?: RemoteFormField<RemoteFormFieldValue>;
		/**
		 * Distinguishes the editor-state ids when two editors share a page.
		 * Sanitised below — callers pass a user id.
		 */
		idPrefix?: string;
		readonly?: boolean;
	} = $props();

	// Callers pass a user id; `field-names.ts` makes it a safe id prefix.
	const safePrefix = $derived(safeFieldPrefix(idPrefix));

	const monitorOptions = $derived([
		{ value: '', label: msg.rider_rider_elements_editor_no_preference() },
		...roster.map((m) => ({
			value: m.userId,
			label: msg.rider_rider_elements_editor_s_mix({ name: m.name })
		}))
	]);

	const rowId = () => crypto.randomUUID();

	function addElement() {
		elements = [
			...elements,
			{ rowId: rowId(), kind: 'vocals', label: '', providedBy: 'band', notes: '', inputs: [] }
		];
	}

	function removeElement(index: number) {
		elements = elements.filter((_, i) => i !== index);
	}

	/** Adjacent swap, the only reorder affordance this codebase has. */
	function moveElement(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= elements.length) return;
		const next = [...elements];
		[next[index], next[target]] = [next[target], next[index]];
		elements = next;
	}

	function addInput(element: RiderElementRowState) {
		element.inputs = [
			...element.inputs,
			{ rowId: rowId(), label: '', source: 'mic', micPref: '', phantom: false, stand: 'none' }
		];
	}

	function removeInput(element: RiderElementRowState, index: number) {
		element.inputs = element.inputs.filter((_, i) => i !== index);
	}

	function moveInput(element: RiderElementRowState, index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= element.inputs.length) return;
		const next = [...element.inputs];
		[next[index], next[target]] = [next[target], next[index]];
		element.inputs = next;
	}

	const text = (v: string | undefined) => v?.trim() ?? '';

	/**
	 * `readonly` on a `FormField` renders the value as text rather than a
	 * disabled control — which is what somebody else's corner should look like —
	 * but for a select it prints the stored value, so `drum_kit` and `di` would
	 * reach the page raw. `display` is where the label goes back on.
	 */
	const mixName = (userId: string | undefined) =>
		userId
			? (roster.find((m) => m.userId === userId)?.name ?? 'Someone') + '’s mix'
			: 'No preference';

	/**
	 * What actually posts. Blank rows drop out rather than riding as empty
	 * strings, and `rowId` never leaves the browser — it exists so `{#each}` can
	 * key by something stable while rows are being reordered, which keying by
	 * index cannot do.
	 */
	const serialized = $derived(
		JSON.stringify(
			elements
				.filter((el) => text(el.label))
				.map((el) => ({
					kind: el.kind,
					label: text(el.label),
					providedBy: el.providedBy ?? 'band',
					...(text(el.notes) ? { notes: text(el.notes) } : {}),
					inputs: (el.kind === 'monitor' ? [] : el.inputs)
						.filter((input) => text(input.label))
						.map((input) => ({
							label: text(input.label),
							source: input.source,
							...(text(input.micPref) ? { micPref: text(input.micPref) } : {}),
							phantom: !!input.phantom,
							stand: input.stand ?? 'none',
							...(input.monitorMixUserId ? { monitorMixUserId: input.monitorMixUserId } : {}),
							...(text(input.notes) ? { notes: text(input.notes) } : {})
						}))
				}))
		)
	);

	const atLimit = $derived(elements.length >= RIDER_MAX_ELEMENTS);
</script>

<!--
	Editor state, not form fields — only the hidden field below posts. The rows
	carry ids, not names: a remote form rejects a name its fields did not hand out.
-->
{#if field && !readonly}
	<input {...field.as('hidden', serialized)} />
{/if}

<div class="space-y-4">
	{#each elements as element, index (element.rowId)}
		<div class="rounded-box border border-base-300 p-4">
			<div class="grid gap-3 md:grid-cols-[1fr_2fr_1fr_auto]">
				<Field
					id="{safePrefix}_kind_{index}"
					type="select"
					label={msg.rider_rider_elements_editor_what()}
					options={riderElementKindOptions}
					bind:value={element.kind}
					{readonly}
					display={riderElementKindLabels[element.kind]}
				/>
				<Field
					id="{safePrefix}_label_{index}"
					type="text"
					label={msg.rider_rider_elements_editor_name()}
					placeholder={msg.rider_rider_elements_editor_e_g_fender_twin()}
					bind:value={element.label}
					{readonly}
				/>
				<Field
					id="{safePrefix}_provided_{index}"
					type="select"
					label={msg.rider_rider_elements_editor_who_brings()}
					options={riderProvidedByOptions}
					bind:value={element.providedBy}
					{readonly}
					display={riderProvidedByLabels[element.providedBy ?? 'band']}
				/>
				{#if !readonly}
					<div class="flex items-end gap-1 pb-1">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							shape="square"
							aria-label={msg.rider_rider_elements_editor_move_up({
								value: element.label || 'item'
							})}
							disabled={index === 0}
							onclick={() => moveElement(index, -1)}
						>
							<IconChevronUp size={16} />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							shape="square"
							aria-label={msg.rider_rider_elements_editor_move_down({
								value: element.label || 'item'
							})}
							disabled={index === elements.length - 1}
							onclick={() => moveElement(index, 1)}
						>
							<IconChevronDown size={16} />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							shape="square"
							aria-label={msg.rider_rider_elements_editor_remove({
								value: element.label || 'item'
							})}
							onclick={() => removeElement(index)}
						>
							<IconTrash size={16} />
						</Button>
					</div>
				{/if}
			</div>

			<Field
				id="{safePrefix}_notes_{index}"
				type="text"
				label={msg.rider_rider_elements_editor_anything_engineer_should_know()}
				placeholder={msg.rider_rider_elements_editor_optional()}
				bind:value={element.notes}
				{readonly}
				display={text(element.notes) || '—'}
				class="mt-3"
			/>

			{#if element.kind === 'monitor'}
				<p class="mt-3 text-xs text-base-content/60">
					{msg.rider_rider_elements_editor_monitor_takes_no_channel_desk()}
				</p>
			{:else}
				<div class="mt-4 border-t border-base-300 pt-3">
					<div class="mb-2 flex items-center justify-between">
						<span class="text-xs font-medium">{msg.rider_rider_elements_editor_inputs()}</span>
						{#if !readonly}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={element.inputs.length >= RIDER_MAX_INPUTS_PER_ELEMENT}
								onclick={() => addInput(element)}
							>
								<IconPlus size={14} />
								{msg.rider_rider_elements_editor_add_input()}
							</Button>
						{/if}
					</div>

					{#if element.inputs.length === 0}
						<p class="text-xs text-base-content/60">
							{msg.rider_rider_elements_editor_no_channels_yet_guitar_amp()}
						</p>
					{/if}

					{#each element.inputs as input, j (input.rowId)}
						<div class="mb-2 grid gap-2 md:grid-cols-[2fr_1fr_2fr_1fr_1fr_auto]">
							<Field
								id="{safePrefix}_inlabel_{index}_{j}"
								type="text"
								label={msg.rider_rider_elements_editor_input()}
								placeholder={msg.rider_rider_elements_editor_e_g_kick()}
								bind:value={input.label}
								{readonly}
							/>
							<Field
								id="{safePrefix}_insource_{index}_{j}"
								type="select"
								label={msg.rider_rider_elements_editor_via()}
								options={riderInputSourceOptions}
								bind:value={input.source}
								{readonly}
								display={riderInputSourceLabels[input.source]}
							/>
							<Field
								id="{safePrefix}_inmic_{index}_{j}"
								type="text"
								label={msg.rider_rider_elements_editor_preferred_mic_di()}
								placeholder={msg.rider_rider_elements_editor_optional_house_may_have_better()}
								bind:value={input.micPref}
								{readonly}
								display={text(input.micPref) || '—'}
							/>
							<Field
								id="{safePrefix}_instand_{index}_{j}"
								type="select"
								label={msg.rider_rider_elements_editor_stand()}
								options={riderStandTypeOptions}
								bind:value={input.stand}
								{readonly}
								display={riderStandTypeLabels[input.stand ?? 'none']}
							/>
							<Field
								id="{safePrefix}_inmix_{index}_{j}"
								type="select"
								label={msg.rider_rider_elements_editor_monitor()}
								options={monitorOptions}
								bind:value={input.monitorMixUserId}
								{readonly}
								display={mixName(input.monitorMixUserId)}
							/>
							<div class="flex items-end gap-1 pb-1">
								<!--
									`label` is explicit because `FormField` falls back to a
									capitalised id, which here is an editor-state id.
								-->
								<Field
									id="{safePrefix}_inphantom_{index}_{j}"
									type="checkbox"
									label={msg.rider_rider_elements_editor_power()}
									checkboxLabel={msg.rider_rider_elements_editor_checkbox_label()}
									bind:value={input.phantom}
									{readonly}
									display={input.phantom ? '+48V' : 'No'}
								/>
								{#if !readonly}
									<Button
										type="button"
										variant="ghost"
										size="sm"
										shape="square"
										aria-label={msg.rider_rider_elements_editor_move_up({
											value: input.label || 'input'
										})}
										disabled={j === 0}
										onclick={() => moveInput(element, j, -1)}
									>
										<IconChevronUp size={14} />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										shape="square"
										aria-label={msg.rider_rider_elements_editor_move_down({
											value: input.label || 'input'
										})}
										disabled={j === element.inputs.length - 1}
										onclick={() => moveInput(element, j, 1)}
									>
										<IconChevronDown size={14} />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										shape="square"
										aria-label={msg.rider_rider_elements_editor_remove({
											value: input.label || 'input'
										})}
										onclick={() => removeInput(element, j)}
									>
										<IconTrash size={14} />
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<!-- The corner's channel count is the badge in the card header. A second one
	     here printed the same number twice, ~80px apart. -->
	{#if !readonly}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<Button type="button" variant="ghost" size="sm" disabled={atLimit} onclick={addElement}>
					<IconPlus size={16} />
					{msg.rider_rider_elements_editor_add_something_stage()}
				</Button>
				{#if atLimit}
					<span class="text-xs text-base-content/60">
						{msg.rider_rider_elements_editor_limit_one_corner({ RIDER_MAX_ELEMENTS })}
					</span>
				{/if}
			</div>
			{#if action}{@render action()}{/if}
		</div>
	{/if}
</div>
