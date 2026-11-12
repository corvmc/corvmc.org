<script lang="ts" module>
	export const datePresets = ['from_today', 'next_7', 'past_30', 'any'] as const;
	export type DateRange = (typeof datePresets)[number] | 'custom';
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { Popover } from 'bits-ui';
	import { IconCalendar } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { formatDateShort } from '#lib/utils/format.js';

	let {
		range = $bindable(),
		from = $bindable(),
		to = $bindable(),
		onchange
	}: {
		range: DateRange;
		/** `YYYY-MM-DD`; read only when `range` is `custom`. */
		from: string;
		to: string;
		onchange?: () => void;
	} = $props();

	const uid = $props.id();
	let open = $state(false);

	const presetLabel: Record<(typeof datePresets)[number], () => string> = {
		from_today: m.staff_reservations_from_today_label,
		next_7: m.staff_reservations_next_7_days_label,
		past_30: m.staff_reservations_past_30_days_label,
		any: m.staff_reservations_any_date_label
	};

	// Noon UTC is the same calendar day in club time, whichever zone the browser is in.
	const day = (d: string) => (d ? formatDateShort(new Date(`${d}T12:00:00Z`)) : '…');
	const label = $derived(range === 'custom' ? `${day(from)} – ${day(to)}` : presetLabel[range]());

	function pick(preset: (typeof datePresets)[number]) {
		range = preset;
		from = '';
		to = '';
		open = false;
		onchange?.();
	}

	function setCustom() {
		range = from || to ? 'custom' : 'from_today';
		onchange?.();
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="default" size="sm" data-testid="date-filter">
				<IconCalendar size={16} />
				<span class="sr-only">{m.staff_reservations_date_label()}:</span>
				{label}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<!-- No Portal: the panel theme is scoped to `[data-panel]`. -->
	<Popover.Content
		sideOffset={4}
		align="start"
		class="z-1000 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-1 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
	>
		{#each datePresets as preset (preset)}
			<button
				type="button"
				class="btn justify-start btn-ghost btn-sm {range === preset ? 'btn-active' : ''}"
				aria-pressed={range === preset}
				data-range={preset}
				onclick={() => pick(preset)}
			>
				{presetLabel[preset]()}
			</button>
		{/each}
		<div class="mt-1 grid grid-cols-2 gap-2 border-t border-base-300 pt-2">
			<label class="flex flex-col gap-1" for="date-from-{uid}">
				<span class="text-muted text-xs">{m.ui_range_from_label()}</span>
				<input
					id="date-from-{uid}"
					type="date"
					class="input input-sm"
					bind:value={from}
					onchange={setCustom}
				/>
			</label>
			<label class="flex flex-col gap-1" for="date-to-{uid}">
				<span class="text-muted text-xs">{m.ui_range_to_label()}</span>
				<input
					id="date-to-{uid}"
					type="date"
					class="input input-sm"
					bind:value={to}
					onchange={setCustom}
				/>
			</label>
		</div>
	</Popover.Content>
</Popover.Root>
