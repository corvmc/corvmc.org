<script lang="ts">
	/**
	 * A segmented allocation control: one total, divided between two parties, with
	 * a third fixed segment that cannot be dragged.
	 *
	 * Humble Bundle's slider, in the shape this app needs. It exists because
	 * showing a buyer where their money goes reliably raises what they pay — a
	 * visible "the band receives $8.41" reframes the question from *what do I owe*
	 * to *what do they get* — and because a cut you can refuse is an ask rather
	 * than a rake.
	 *
	 * Domain-free by construction: it knows about a total, two movable shares and
	 * a locked remainder, and nothing about music, bands or Stripe. That is what
	 * keeps it in `ui/`.
	 *
	 * **Pointer drag is the affordance, not the mechanism.** The divider is a real
	 * `role="slider"` with arrow-key support, and the number inputs below are a
	 * complete alternative path — someone who cannot drag can still allocate to
	 * the cent. A drag-only control here would put the price of the thing behind a
	 * gesture.
	 */
	let {
		totalCents,
		/**
		 * The movable share, in cents.
		 *
		 * A value plus `onchange` rather than `$bindable`, because callers want to
		 * hold this as a `$derived` that falls back to a suggestion until the user
		 * touches it — and a derived cannot be bound to.
		 */
		value,
		onchange,
		/** Cannot be dragged below this — what the other party is owed. */
		otherFloorCents = 0,
		/** A fixed, unmovable slice taken off the top (card processing). */
		fixedCents = 0,
		fixedLabel = 'Fees',
		valueLabel,
		otherLabel,
		step = 25
	}: {
		totalCents: number;
		value: number;
		onchange: (cents: number) => void;
		otherFloorCents?: number;
		fixedCents?: number;
		fixedLabel?: string;
		valueLabel: string;
		otherLabel: string;
		/** Arrow-key increment, in cents. */
		step?: number;
	} = $props();

	const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

	/**
	 * The most the movable share can take: everything except the fixed slice and
	 * the other party's floor. Never negative — a total below the floor plus fees
	 * would otherwise produce a max under zero and an unusable control.
	 */
	const maxValue = $derived(Math.max(0, totalCents - fixedCents - otherFloorCents));
	const clamped = $derived(Math.min(Math.max(value, 0), maxValue));
	const otherCents = $derived(Math.max(0, totalCents - fixedCents - clamped));

	const pct = (cents: number) => (totalCents > 0 ? (cents / totalCents) * 100 : 0);

	let track = $state<HTMLDivElement | null>(null);
	let dragging = $state(false);

	/** Position within the track → the movable share, snapped to whole cents. */
	function fromClientX(clientX: number) {
		if (!track || totalCents <= 0) return;
		const rect = track.getBoundingClientRect();
		if (rect.width === 0) return;
		const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		// The divider sits at the boundary between the two movable shares, and the
		// *other* share is drawn first, so position maps to the remainder.
		const other = Math.round(ratio * totalCents);
		onchange(Math.min(maxValue, Math.max(0, totalCents - fixedCents - other)));
	}

	function nudge(deltaCents: number) {
		onchange(Math.min(maxValue, Math.max(0, clamped + deltaCents)));
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
			onchange(0);
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
			class="flex items-center justify-center overflow-hidden bg-success/25 whitespace-nowrap"
			style="width: {pct(otherCents)}%"
		>
			{#if pct(otherCents) > 22}<span class="px-2">{otherLabel} {dollars(otherCents)}</span>{/if}
		</div>
		<div
			class="flex items-center justify-center overflow-hidden bg-primary/25 whitespace-nowrap"
			style="width: {pct(clamped)}%"
		>
			{#if pct(clamped) > 22}<span class="px-2">{valueLabel} {dollars(clamped)}</span>{/if}
		</div>
		{#if fixedCents > 0}
			<!-- Locked, and shown rather than hidden: an unexplained missing 59¢
			     reads worse than a labelled one. -->
			<div
				class="flex items-center justify-center overflow-hidden bg-base-300 text-subtle whitespace-nowrap"
				style="width: {pct(fixedCents)}%"
				title="{fixedLabel} {dollars(fixedCents)}"
			>
				{#if pct(fixedCents) > 22}<span class="px-2">{dollars(fixedCents)}</span>{/if}
			</div>
		{/if}
	</div>

	<!-- The divider, as a control rather than as decoration. -->
	<div
		role="slider"
		tabindex="0"
		aria-label="{valueLabel} share"
		aria-valuemin={0}
		aria-valuemax={maxValue}
		aria-valuenow={clamped}
		aria-valuetext="{valueLabel} {dollars(clamped)}, {otherLabel} {dollars(otherCents)}"
		class="sr-only"
		onkeydown={onKeydown}
	></div>

	<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
		<span><span class="font-medium">{otherLabel}</span> {dollars(otherCents)}</span>
		<span class="text-muted">{valueLabel} {dollars(clamped)}</span>
		{#if fixedCents > 0}
			<span class="text-subtle">{fixedLabel} {dollars(fixedCents)}</span>
		{/if}
	</div>

	<!-- The accessible and fine-grained path: everything the drag does, typed. -->
	<details>
		<summary class="cursor-pointer text-muted">Adjust exactly</summary>
		<div class="mt-2 flex flex-wrap items-end gap-3">
			<label class="flex flex-col">
				<span class="text-subtle">{valueLabel} (dollars)</span>
				<input
					type="number"
					class="input w-28 input-sm"
					min="0"
					max={(maxValue / 100).toFixed(2)}
					step="0.25"
					value={(clamped / 100).toFixed(2)}
					oninput={(e) => {
						const next = Math.round(Number(e.currentTarget.value) * 100);
						if (Number.isFinite(next)) onchange(Math.min(maxValue, Math.max(0, next)));
					}}
				/>
			</label>
			<button type="button" class="btn btn-ghost btn-sm" onclick={() => onchange(0)}> None </button>
		</div>
	</details>
</div>
