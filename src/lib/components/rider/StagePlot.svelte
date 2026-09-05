<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { riderElementKindLabels } from '$lib/config';
	import { safeFieldPrefix } from './field-names';
	import type { RemoteFormField, RemoteFormFieldValue } from '@sveltejs/kit';

	/**
	 * Where everything stands, drawn on the stage.
	 *
	 * **Drag is the affordance, not the mechanism** — the rule `SplitBar` states
	 * and the reason this is not a canvas. Every item is a real focusable button
	 * that arrow keys move a percent at a time (ten with shift), and the
	 * "Place exactly" disclosure below is a complete typed path to the same two
	 * numbers. Somebody who cannot drag can still lay out a stage.
	 *
	 * That is also why there is **no plotting library**. `docs/reports/library-candidates.md` lists `konva`
	 * for this and `conventions.md#dependency-posture` would ordinarily favour
	 * taking it — but a canvas draws pixels, not focusable controls, so the
	 * keyboard and screen-reader path would have to be built beside it anyway.
	 * Twelve absolutely-positioned buttons in a labelled region are less code
	 * than that, and they inherit the theme, the fonts and the print stylesheet
	 * for free.
	 *
	 * Positions are percentages of the stage, so the picture reads the same in
	 * any room — a stage plot is about relative position, and these acts play
	 * more rooms than CMC's.
	 */
	type Item = {
		id: string;
		label: string;
		kind: keyof typeof riderElementKindLabels;
		ownerName: string | null;
		x: number | null;
		y: number | null;
		/** Whether this viewer may move it: their own gear, or anything if admin. */
		movable: boolean;
	};

	let {
		items,
		field,
		readonly = false
	}: {
		items: Item[];
		field?: RemoteFormField<RemoteFormFieldValue>;
		readonly?: boolean;
	} = $props();

	/** Working copy, so a drag is not a write. Saved by the form this sits in. */
	let placed = $state<Record<string, { x: number; y: number } | null>>({});

	$effect(() => {
		const next: Record<string, { x: number; y: number } | null> = {};
		for (const item of items) {
			next[item.id] = item.x !== null && item.y !== null ? { x: item.x, y: item.y } : null;
		}
		placed = next;
	});

	const onStage = $derived(items.filter((i) => placed[i.id]));
	const unplaced = $derived(items.filter((i) => !placed[i.id]));

	let stage = $state<HTMLDivElement | null>(null);
	let dragging = $state<string | null>(null);

	const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

	function moveTo(id: string, clientX: number, clientY: number) {
		if (!stage) return;
		const box = stage.getBoundingClientRect();
		placed[id] = {
			x: clamp(((clientX - box.left) / box.width) * 100),
			y: clamp(((clientY - box.top) / box.height) * 100)
		};
	}

	function nudge(id: string, dx: number, dy: number) {
		const at = placed[id];
		if (!at) return;
		placed[id] = { x: clamp(at.x + dx), y: clamp(at.y + dy) };
	}

	function place(id: string) {
		// Centre-ish, so a newly placed item lands somewhere you can see rather
		// than under whatever is already at the origin.
		placed[id] = { x: 50, y: 50 };
	}

	function remove(id: string) {
		placed[id] = null;
	}

	function onKey(event: KeyboardEvent, id: string) {
		const step = event.shiftKey ? 10 : 1;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		nudge(id, move[0], move[1]);
	}

	const serialized = $derived(
		JSON.stringify(
			items
				.filter((i) => i.movable)
				.map((i) => ({ elementId: i.id, x: placed[i.id]?.x ?? null, y: placed[i.id]?.y ?? null }))
		)
	);
</script>

<svelte:window
	onpointermove={(e) => dragging && moveTo(dragging, e.clientX, e.clientY)}
	onpointerup={() => (dragging = null)}
/>

{#if field && !readonly}
	<input {...field.as('hidden', serialized)} />
{/if}

<div
	bind:this={stage}
	class="stage"
	role="group"
	aria-label="Stage plot. Audience is at the bottom."
>
	<span class="stage-edge stage-edge-back">Back of stage</span>
	<span class="stage-edge stage-edge-front">Audience</span>

	{#each onStage as item (item.id)}
		{@const at = placed[item.id]!}
		<button
			type="button"
			class="pin"
			class:pin-static={readonly || !item.movable}
			style="left:{at.x}%; top:{at.y}%"
			disabled={readonly || !item.movable}
			aria-label="{item.label}{item.ownerName ? `, ${item.ownerName}` : ''}. {at.x} percent across,
			{at.y} percent back. Arrow keys to move."
			onpointerdown={(e) => {
				if (readonly || !item.movable) return;
				e.preventDefault();
				dragging = item.id;
			}}
			onkeydown={(e) => !readonly && item.movable && onKey(e, item.id)}
		>
			<span class="pin-label">{item.label}</span>
			{#if item.ownerName}<span class="pin-owner">{item.ownerName}</span>{/if}
		</button>
	{/each}
</div>

{#if !readonly}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		{#if unplaced.length}
			<span class="text-xs text-base-content/60">Not on the stage yet:</span>
			{#each unplaced as item (item.id)}
				<Button variant="ghost" size="sm" disabled={!item.movable} onclick={() => place(item.id)}>
					{item.label}
				</Button>
			{/each}
		{:else}
			<span class="text-xs text-base-content/60">Everything is on the stage.</span>
		{/if}
	</div>

	<details class="mt-3">
		<summary class="cursor-pointer text-xs text-base-content/60">Place exactly</summary>
		<p class="mt-2 text-xs text-base-content/60">
			Percentages across and back. The same two numbers dragging sets — this is here so the plot
			does not need a mouse.
		</p>
		<div class="mt-2 space-y-2">
			{#each onStage as item, i (item.id)}
				{@const at = placed[item.id]!}
				<div class="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
					<span class="self-end pb-2 text-sm">
						{item.label}
						<span class="text-base-content/50">· {riderElementKindLabels[item.kind]}</span>
					</span>
					<Field
						name="{safeFieldPrefix(item.id)}_x_{i}"
						type="number"
						label="Across"
						value={String(at.x)}
						disabled={!item.movable}
						oninput={(e: Event) =>
							(placed[item.id] = {
								...at,
								x: clamp(Number((e.currentTarget as HTMLInputElement).value))
							})}
					/>
					<Field
						name="{safeFieldPrefix(item.id)}_y_{i}"
						type="number"
						label="Back"
						value={String(at.y)}
						disabled={!item.movable}
						oninput={(e: Event) =>
							(placed[item.id] = {
								...at,
								y: clamp(Number((e.currentTarget as HTMLInputElement).value))
							})}
					/>
					<div class="flex items-end pb-1">
						<Button
							variant="ghost"
							size="sm"
							disabled={!item.movable}
							onclick={() => remove(item.id)}
						>
							Take off
						</Button>
					</div>
				</div>
			{/each}
		</div>
	</details>
{/if}

<style>
	.stage {
		position: relative;
		aspect-ratio: 3 / 2;
		width: 100%;
		border: 2px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		background: var(--color-base-200);
		overflow: hidden;
		touch-action: none;
	}

	.stage-edge {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.45;
	}

	.stage-edge-back {
		top: 0.35rem;
	}

	.stage-edge-front {
		bottom: 0.35rem;
	}

	.pin {
		position: absolute;
		transform: translate(-50%, -50%);
		max-width: 40%;
		padding: 0.3rem 0.55rem;
		border: 1px solid var(--color-base-content);
		border-radius: var(--radius-field, 0.375rem);
		background: var(--color-base-100);
		font-size: 0.75rem;
		line-height: 1.15;
		text-align: left;
		cursor: grab;
	}

	.pin:active {
		cursor: grabbing;
	}

	.pin-static {
		cursor: default;
		opacity: 0.75;
	}

	.pin-label {
		display: block;
		font-weight: 600;
	}

	.pin-owner {
		display: block;
		opacity: 0.6;
	}
</style>
