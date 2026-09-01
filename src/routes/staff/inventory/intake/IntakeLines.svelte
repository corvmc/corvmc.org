<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import StickyBar from '$lib/components/ui/StickyBar.svelte';
	// Not `MoneyField`: that one owns a remote form field and posts cents through
	// a hidden sibling, and these rows are local state serialized into one JSON
	// field. The dollars-in/cents-out conversion happens in `centsOf` below.
	import { Field } from '$lib/components/ui/Form';
	import { formatCents } from '$lib/utils/format';
	import { equipmentConditions } from '$lib/config';
	import { IconPlus, IconTrash } from '@tabler/icons-svelte';

	/**
	 * The "what arrived" half of an intake session.
	 *
	 * Repeated rows serialized into one hidden JSON field, the shape
	 * `LineupEditor` established for a bill: a remote form's `FormData` cannot
	 * express an array of objects, and a request per line is the round-trip
	 * explosion `recordAcquisitionBulk` exists to avoid.
	 *
	 * A serialized line expands to one row per unit — tag, serial, condition —
	 * because the service has always accepted per-unit detail and only the form
	 * truncated it. Leaving a tag blank is normal and expected: gear reaches the
	 * bench before the sticker roll does, and `/staff/inventory/tagging` is the
	 * queue that finishes the job.
	 */
	type Unit = { assetTag: string; serialNumber: string; condition: string };
	type Line = { itemId: string; quantity: number; unitCost: string; units: Unit[] };

	let {
		items,
		lines = $bindable()
	}: {
		items: { id: string; name: string; kind: string; categoryName: string | null }[];
		lines: Line[];
	} = $props();

	const itemById = $derived(new Map(items.map((i) => [i.id, i])));

	const options = $derived([
		{ value: '', label: 'Pick an item…' },
		...items.map((i) => ({
			value: i.id,
			label: i.categoryName ? `${i.categoryName} → ${i.name}` : i.name
		}))
	]);

	/** Four plain adjectives; a config label map would only restate them. */
	const conditionOptions = equipmentConditions.map((c) => ({
		value: c,
		label: c.slice(0, 1).toUpperCase() + c.slice(1)
	}));

	function blankUnit(): Unit {
		return { assetTag: '', serialNumber: '', condition: 'good' };
	}

	function addLine() {
		lines = [...lines, { itemId: '', quantity: 1, unitCost: '', units: [] }];
	}

	function removeLine(index: number) {
		lines = lines.filter((_, i) => i !== index);
	}

	/**
	 * A serialized line keeps exactly `quantity` unit rows, so the two can never
	 * disagree — the service rejects a payload where they do, and finding that
	 * out on submit after twenty minutes of typing is the wrong place to learn it.
	 */
	function syncUnits(line: Line) {
		if (itemById.get(line.itemId)?.kind !== 'serialized') {
			line.units = [];
			return;
		}
		const want = Math.max(0, line.quantity);
		while (line.units.length < want) line.units.push(blankUnit());
		if (line.units.length > want) line.units = line.units.slice(0, want);
	}

	function isSerialized(line: Line) {
		return itemById.get(line.itemId)?.kind === 'serialized';
	}

	const centsOf = (v: string) => {
		const parsed = Number.parseFloat(v);
		return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
	};

	const unitTotal = $derived(
		lines.reduce((n, l) => n + (isSerialized(l) ? l.units.length : l.quantity), 0)
	);
	const valueTotal = $derived(lines.reduce((n, l) => n + centsOf(l.unitCost) * l.quantity, 0));
	const needsTagging = $derived(
		lines.reduce((n, l) => n + l.units.filter((u) => !u.assetTag.trim()).length, 0)
	);

	/** What actually posts. Empty strings drop out rather than riding as `''`. */
	const serialized = $derived(
		JSON.stringify(
			lines
				.filter((l) => l.itemId)
				.map((l) => ({
					itemId: l.itemId,
					quantity: l.quantity,
					...(l.unitCost.trim() ? { unitValueCents: centsOf(l.unitCost) } : {}),
					...(isSerialized(l)
						? {
								units: l.units.map((u) => ({
									...(u.assetTag.trim() ? { assetTag: u.assetTag.trim() } : {}),
									...(u.serialNumber.trim() ? { serialNumber: u.serialNumber.trim() } : {}),
									condition: u.condition
								}))
							}
						: {})
				}))
		)
	);
</script>

<!--
	These rows are editor state, not form fields — only `lines` below posts. They
	still carry names, because a `FormField` label is a `<legend>` and an unnamed
	input is reachable by neither name nor label.

	The names are underscored rather than hyphenated for a hard reason: SvelteKit
	parses every submitted field name into a schema path against
	`/^[a-zA-Z_$]\w*(\.[a-zA-Z_$]\w*|\[\d+\])*$/`, and a hyphen fails it — the
	whole submit dies with `Invalid path line-item-0` and a 500 before Zod ever
	runs. Underscores and digits are `\w`, so these parse as plain keys and Zod
	strips them as unknown.
-->
<input type="hidden" name="lines" value={serialized} />

<div class="space-y-4">
	{#each lines as line, index (index)}
		<div class="rounded-box border border-base-300 p-4">
			<div class="grid gap-3 md:grid-cols-[2fr_auto_auto_auto]">
				<Field
					name="lineItem_{index}"
					type="select"
					label="Item"
					{options}
					bind:value={line.itemId}
					onchange={() => syncUnits(line)}
				/>
				<Field
					name="lineQty_{index}"
					type="number"
					label="Quantity"
					min="1"
					bind:value={line.quantity}
					onchange={() => syncUnits(line)}
				/>
				<div class="w-32">
					<Field name="lineCost_{index}" type="text" label="Each ($)" bind:value={line.unitCost} />
				</div>
				<div class="flex items-end pb-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-label="Remove line {index + 1}"
						onclick={() => removeLine(index)}
					>
						{#snippet icon()}<IconTrash size={16} />{/snippet}
					</Button>
				</div>
			</div>

			{#if isSerialized(line) && line.units.length > 0}
				<div class="mt-3 space-y-2">
					<p class="text-subtle text-sm">
						One row per unit. A blank tag is fine — it lands in the tagging queue.
					</p>
					{#each line.units as unit, u (u)}
						<div class="grid gap-2 md:grid-cols-3">
							<Field
								name="unitTag_{index}_{u}"
								type="text"
								label={u === 0 ? 'Asset tag' : undefined}
								placeholder="CMC-000123"
								bind:value={unit.assetTag}
							/>
							<Field
								name="unitSerial_{index}_{u}"
								type="text"
								label={u === 0 ? 'Serial' : undefined}
								bind:value={unit.serialNumber}
							/>
							<Field
								name="unitCondition_{index}_{u}"
								type="select"
								label={u === 0 ? 'Condition' : undefined}
								options={conditionOptions}
								bind:value={unit.condition}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<Button type="button" variant="ghost" size="sm" onclick={addLine}>
		{#snippet icon()}<IconPlus size={16} />{/snippet}
		Add a line
	</Button>
</div>

<!-- The running tally: what this session will write, before it writes it. -->
<StickyBar class="mt-4 flex flex-wrap items-center gap-3">
	<span><strong>{lines.filter((l) => l.itemId).length}</strong> lines</span>
	<span><strong>{unitTotal}</strong> units</span>
	<span><strong>{formatCents(valueTotal)}</strong></span>
	{#if needsTagging > 0}
		<Badge variant="warning" size="sm">{needsTagging} will need tagging</Badge>
	{/if}
</StickyBar>
