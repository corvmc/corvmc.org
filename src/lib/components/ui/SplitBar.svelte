<script lang="ts" module>
	/**
	 * Segment colours, as **literal** class strings.
	 *
	 * A computed class name (`bg-${tone}-300`) emits no CSS at all — Tailwind
	 * scans source text and never sees it. Keeping the variants as a lookup table
	 * of whole literals is what makes them survive the build.
	 */
	const TONES = {
		blue: 'bg-info/30',
		orange: 'bg-primary/30',
		gray: 'bg-base-300',
		gold: 'bg-warning/50'
	} as const;

	export type SplitTone = keyof typeof TONES;
</script>

<script lang="ts">
	/**
	 * A segmented allocation control: one total, divided between two parties,
	 * with a fixed slice carved out of the second party's share.
	 *
	 * Humble Bundle's slider, in the shape this app needs. It exists because
	 * showing a buyer where their money goes reliably raises what they pay — a
	 * visible "the band receives $9.00" reframes the question from *what do I
	 * owe* to *what do they get* — and because a cut you can refuse is an ask
	 * rather than a rake.
	 *
	 * **The caller supplies the segment widths.** How a fixed cost divides between
	 * the two parties is the caller's arithmetic, not the bar's — here it is
	 * apportioned in proportion to each share, which is a domain rule this
	 * component has no business knowing. It is told what to draw and what range
	 * the drag spans, and nothing else.
	 *
	 * Domain-free by construction: a total, two shares and a carve-out, and
	 * nothing about music, bands or Stripe. That is what keeps it in `ui/`.
	 *
	 * **Pointer drag is the affordance, not the mechanism.** The divider is a
	 * real `role="slider"` with arrow-key support, and the number input below is
	 * a complete alternative path — someone who cannot drag can still allocate to
	 * the cent. A drag-only control would put the price of the thing behind a
	 * gesture.
	 */
	let {
		totalCents,
		/**
		 * What the drag sets: the movable party's allocation, in cents.
		 *
		 * A value plus `onchange` rather than `$bindable`, because callers hold
		 * this as a `$derived` that falls back to a suggestion until the user
		 * touches it — and a derived cannot be bound to.
		 */
		value,
		onchange,
		/** Rendered widths, in cents. Must sum to `totalCents`. */
		segments,
		/** The fixed slice's width, drawn last. */
		fixedCents = 0,
		fixedLabel = 'Fees',
		/** Turns the fixed slice gold — someone else is covering it now. */
		fixedCovered = false,
		valueLabel,
		otherLabel,
		otherTone = 'blue',
		valueTone = 'orange',
		step = 25
	}: {
		totalCents: number;
		value: number;
		onchange: (cents: number) => void;
		segments: { other: number; value: number };
		fixedCents?: number;
		fixedLabel?: string;
		fixedCovered?: boolean;
		valueLabel: string;
		otherLabel: string;
		otherTone?: SplitTone;
		valueTone?: SplitTone;
		/** Arrow-key increment, in cents. */
		step?: number;
	} = $props();

	const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

	const minValue = 0;
	const maxValue = $derived(Math.max(0, totalCents));
	const clamped = $derived(Math.min(Math.max(value, minValue), maxValue));

	/** What each party actually keeps — supplied, not derived. */
	const otherCents = $derived(Math.max(0, segments.other));
	const valueNetCents = $derived(Math.max(0, segments.value));

	const pct = (cents: number) => (totalCents > 0 ? (cents / totalCents) * 100 : 0);

	let track = $state<HTMLDivElement | null>(null);
	let dragging = $state(false);

	function fromClientX(clientX: number) {
		if (!track || totalCents <= 0) return;
		const rect = track.getBoundingClientRect();
		if (rect.width === 0) return;
		const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		// The divider sits at the boundary between the two shares, and the other
		// party's is drawn first, so position maps to the remainder.
		const other = Math.round(ratio * totalCents);
		onchange(Math.min(maxValue, Math.max(minValue, totalCents - other)));
	}

	function nudge(deltaCents: number) {
		onchange(Math.min(maxValue, Math.max(minValue, clamped + deltaCents)));
	}

	function onKeydown(e: KeyboardEvent) {
		const keys: Record<string, number> = {
			ArrowRight: step,
			ArrowUp: step,
			ArrowLeft: -step,
			ArrowDown: -step,
			PageUp: step * 4,
			PageDown: -step * 4
		};
		if (e.key === 'Home') {
			e.preventDefault();
			onchange(minValue);
			return;
		}
		if (e.key === 'End') {
			e.preventDefault();
			onchange(maxValue);
			return;
		}
		const delta = keys[e.key];
		if (delta === undefined) return;
		e.preventDefault();
		nudge(delta);
	}
</script>

<svelte:window
	onpointermove={(e) => dragging && fromClientX(e.clientX)}
	onpointerup={() => (dragging = false)}
/>

<div class="space-y-2">
	<div
		bind:this={track}
		class="flex h-10 w-full overflow-hidden rounded border border-base-300"
		onpointerdown={(e) => {
			dragging = true;
			fromClientX(e.clientX);
		}}
		role="presentation"
	>
		<div
			class="flex items-center justify-center overflow-hidden whitespace-nowrap {TONES[otherTone]}"
			style="width: {pct(otherCents)}%"
		>
			{#if pct(otherCents) > 24}<span class="px-2">{otherLabel} {dollars(otherCents)}</span>{/if}
		</div>
		<div
			class="flex items-center justify-center overflow-hidden whitespace-nowrap {TONES[valueTone]}"
			style="width: {pct(valueNetCents)}%"
		>
			{#if pct(valueNetCents) > 24}<span class="px-2">
					{valueLabel}
					{dollars(valueNetCents)}
				</span>{/if}
		</div>
		{#if fixedCents > 0}
			<!--
				Shown rather than hidden, and carved out of the movable share it
				belongs to: an unexplained missing 59¢ reads worse than a labelled
				one, and drawing it off the top would credit that share with money it
				never keeps. Gold once somebody else is covering it.
			-->
			<div
				class="flex items-center justify-center overflow-hidden text-subtle whitespace-nowrap {fixedCovered
					? TONES.gold
					: TONES.gray}"
				style="width: {pct(fixedCents)}%"
				title="{fixedLabel} {dollars(fixedCents)}"
			>
				{#if pct(fixedCents) > 24}<span class="px-2">{dollars(fixedCents)}</span>{/if}
			</div>
		{/if}
	</div>

	<!-- The divider, as a control rather than as decoration. -->
	<div
		role="slider"
		tabindex="0"
		aria-label="{valueLabel} share"
		aria-valuemin={minValue}
		aria-valuemax={maxValue}
		aria-valuenow={clamped}
		aria-valuetext="{valueLabel} {dollars(valueNetCents)}, {otherLabel} {dollars(
			otherCents
		)}, {fixedLabel} {dollars(fixedCents)}"
		class="sr-only"
		onkeydown={onKeydown}
	></div>

	<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
		<span class="flex items-center gap-1.5">
			<span class="size-3 rounded-sm {TONES[otherTone]}" aria-hidden="true"></span>
			<span class="font-medium">{otherLabel}</span>
			{dollars(otherCents)}
		</span>
		<span class="flex items-center gap-1.5">
			<span class="size-3 rounded-sm {TONES[valueTone]}" aria-hidden="true"></span>
			{valueLabel}
			{dollars(valueNetCents)}
		</span>
		{#if fixedCents > 0}
			<span class="flex items-center gap-1.5 text-muted">
				<span class="size-3 rounded-sm {fixedCovered ? TONES.gold : TONES.gray}" aria-hidden="true"
				></span>
				{fixedLabel}
				{dollars(fixedCents)}
			</span>
		{/if}
	</div>

	<!-- The accessible and fine-grained path: everything the drag does, typed. -->
	<details>
		<summary class="cursor-pointer text-muted">Adjust exactly</summary>
		<div class="mt-2 flex flex-wrap items-end gap-3">
			<label class="flex flex-col">
				<span class="text-subtle">{valueLabel} share (dollars)</span>
				<input
					type="number"
					class="input w-28 input-sm"
					min="0"
					max={(maxValue / 100).toFixed(2)}
					step="0.25"
					value={(clamped / 100).toFixed(2)}
					oninput={(e) => {
						const next = Math.round(Number(e.currentTarget.value) * 100);
						if (Number.isFinite(next)) onchange(Math.min(maxValue, Math.max(minValue, next)));
					}}
				/>
			</label>
			<button type="button" class="btn btn-ghost btn-sm" onclick={() => onchange(minValue)}>
				None
			</button>
		</div>
	</details>
</div>
