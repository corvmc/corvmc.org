<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { Field } from '$lib/components/ui/Form';
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
	} from '$lib/config';
	import type { RiderElementRowState } from '$lib/types/rider';
	import type { RemoteFormField, RemoteFormFieldValue } from '@sveltejs/kit';
	import { safeFieldPrefix } from './field-names';
	import { IconPlus, IconTrash, IconChevronUp, IconChevronDown } from '@tabler/icons-svelte';

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
		readonly = false
	}: {
		elements: RiderElementRowState[];
		/** Whose monitor mix an input can feed. */
		roster: { userId: string; name: string }[];
		/**
		 * The remote form's own `elements` field.
		 *
		 * Taken from the form rather than emitted as `name="elements"`: a remote
		 * form encodes its field names, so a child component's plain `name` never
		 * reaches it and the field arrives as `undefined` with nothing on screen
		 * to show for it. The editor-state inputs below keep plain names because
		 * they are *meant* not to arrive — Zod strips them as unknown.
		 */
		field?: RemoteFormField<RemoteFormFieldValue>;
		/**
		 * Distinguishes the editor-state field names when two editors share a page.
		 * Sanitised below — callers pass a user id, which is not a legal field name.
		 */
		idPrefix?: string;
		readonly?: boolean;
	} = $props();

	// Callers pass a user id, which is never a legal field name. `field-names.ts`
	// says why, and its spec is what keeps the answer right.
	const safePrefix = $derived(safeFieldPrefix(idPrefix));

	const monitorOptions = $derived([
		{ value: '', label: 'No preference' },
		...roster.map((m) => ({ value: m.userId, label: `${m.name}’s mix` }))
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

	const inputTotal = $derived(
		elements.reduce(
			(n, el) => n + (el.kind === 'monitor' ? 0 : el.inputs.filter((i) => text(i.label)).length),
			0
		)
	);
</script>

<!--
	Editor state, not form fields — only the hidden field below posts. The rows
	still carry names because a `Field` label is bound to its input by name, and
	the names are underscored rather than hyphenated for a hard reason: SvelteKit
	parses every submitted name into a schema path against
	`/^[a-zA-Z_$]\w*(\.[a-zA-Z_$]\w*|\[\d+\])*$/`, and a hyphen fails it — the
	submit dies with `Invalid path` as a 500 before Zod ever runs.
-->
{#if field && !readonly}
	<input {...field.as('hidden', serialized)} />
{/if}

<div class="space-y-4">
	{#each elements as element, index (element.rowId)}
		<div class="rounded-box border border-base-300 p-4">
			<div class="grid gap-3 md:grid-cols-[1fr_2fr_1fr_auto]">
				<Field
					name="{safePrefix}_kind_{index}"
					type="select"
					label="What it is"
					options={riderElementKindOptions}
					bind:value={element.kind}
					{readonly}
					display={riderElementKindLabels[element.kind]}
				/>
				<Field
					name="{safePrefix}_label_{index}"
					type="text"
					label="Name it"
					placeholder="e.g. Fender Twin"
					bind:value={element.label}
					{readonly}
				/>
				<Field
					name="{safePrefix}_provided_{index}"
					type="select"
					label="Who brings it"
					options={riderProvidedByOptions}
					bind:value={element.providedBy}
					{readonly}
					display={riderProvidedByLabels[element.providedBy ?? 'band']}
				/>
				{#if !readonly}
					<div class="flex items-end gap-1 pb-1">
						<Button
							variant="ghost"
							size="sm"
							square
							aria-label="Move {element.label || 'item'} up"
							disabled={index === 0}
							onclick={() => moveElement(index, -1)}
						>
							<IconChevronUp size={16} />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							square
							aria-label="Move {element.label || 'item'} down"
							disabled={index === elements.length - 1}
							onclick={() => moveElement(index, 1)}
						>
							<IconChevronDown size={16} />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							square
							aria-label="Remove {element.label || 'item'}"
							onclick={() => removeElement(index)}
						>
							<IconTrash size={16} />
						</Button>
					</div>
				{/if}
			</div>

			<Field
				name="{safePrefix}_notes_{index}"
				type="text"
				label="Anything the engineer should know"
				placeholder="Optional"
				bind:value={element.notes}
				{readonly}
				display={text(element.notes) || '—'}
				class="mt-3"
			/>

			{#if element.kind === 'monitor'}
				<p class="mt-3 text-xs text-base-content/60">
					A monitor takes no channel on the desk, so it has no inputs — it is here so the mix count
					is right and the stage plot has something to draw.
				</p>
			{:else}
				<div class="mt-4 border-t border-base-300 pt-3">
					<div class="mb-2 flex items-center justify-between">
						<span class="text-xs font-medium">Inputs</span>
						{#if !readonly}
							<Button
								variant="ghost"
								size="sm"
								disabled={element.inputs.length >= RIDER_MAX_INPUTS_PER_ELEMENT}
								onclick={() => addInput(element)}
							>
								<IconPlus size={14} /> Add input
							</Button>
						{/if}
					</div>

					{#if element.inputs.length === 0}
						<p class="text-xs text-base-content/60">
							No channels yet. A guitar amp usually needs one mic; a kit needs several.
						</p>
					{/if}

					{#each element.inputs as input, j (input.rowId)}
						<div class="mb-2 grid gap-2 md:grid-cols-[2fr_1fr_2fr_1fr_1fr_auto]">
							<Field
								name="{safePrefix}_inlabel_{index}_{j}"
								type="text"
								label="Input"
								placeholder="e.g. Kick in"
								bind:value={input.label}
								{readonly}
							/>
							<Field
								name="{safePrefix}_insource_{index}_{j}"
								type="select"
								label="Via"
								options={riderInputSourceOptions}
								bind:value={input.source}
								{readonly}
								display={riderInputSourceLabels[input.source]}
							/>
							<Field
								name="{safePrefix}_inmic_{index}_{j}"
								type="text"
								label="Preferred mic/DI"
								placeholder="Optional — the house may have better"
								bind:value={input.micPref}
								{readonly}
								display={text(input.micPref) || '—'}
							/>
							<Field
								name="{safePrefix}_instand_{index}_{j}"
								type="select"
								label="Stand"
								options={riderStandTypeOptions}
								bind:value={input.stand}
								{readonly}
								display={riderStandTypeLabels[input.stand ?? 'none']}
							/>
							<Field
								name="{safePrefix}_inmix_{index}_{j}"
								type="select"
								label="Monitor"
								options={monitorOptions}
								bind:value={input.monitorMixUserId}
								{readonly}
								display={mixName(input.monitorMixUserId)}
							/>
							<div class="flex items-end gap-1 pb-1">
								<!--
									`label` is explicit because `FormField` falls back to a
									capitalised `name` — and these names are editor-state ids, so
									the fallback rendered "Seed-rider-member_inphantom_0_0" above
									the box.
								-->
								<Field
									name="{safePrefix}_inphantom_{index}_{j}"
									type="checkbox"
									label="Power"
									checkboxLabel="+48V"
									bind:value={input.phantom}
									{readonly}
									display={input.phantom ? '+48V' : 'No'}
								/>
								{#if !readonly}
									<Button
										variant="ghost"
										size="sm"
										square
										aria-label="Move {input.label || 'input'} up"
										disabled={j === 0}
										onclick={() => moveInput(element, j, -1)}
									>
										<IconChevronUp size={14} />
									</Button>
									<Button
										variant="ghost"
										size="sm"
										square
										aria-label="Move {input.label || 'input'} down"
										disabled={j === element.inputs.length - 1}
										onclick={() => moveInput(element, j, 1)}
									>
										<IconChevronDown size={14} />
									</Button>
									<Button
										variant="ghost"
										size="sm"
										square
										aria-label="Remove {input.label || 'input'}"
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

	<div class="flex items-center justify-between">
		{#if !readonly}
			<Button
				variant="ghost"
				size="sm"
				disabled={elements.length >= RIDER_MAX_ELEMENTS}
				onclick={addElement}
			>
				<IconPlus size={16} /> Add something to the stage
			</Button>
		{:else}
			<span></span>
		{/if}
		<Badge>{inputTotal} {inputTotal === 1 ? 'input' : 'inputs'}</Badge>
	</div>
</div>
