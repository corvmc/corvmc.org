<script lang="ts">
	import { tick } from 'svelte';
	import { Calendar, Popover } from 'bits-ui';
	import { parseDate } from '@internationalized/date';
	import { IconCalendar, IconChevronLeft, IconChevronRight } from '@tabler/icons-svelte';
	import { formatSlotTime } from '#lib/utils/format.js';

	type HiddenField = { as: (type: 'hidden', value: string) => Record<string, unknown> };

	let {
		id,
		date: dateField,
		time: timeField,
		dateValue = $bindable(''),
		timeValue = $bindable(''),
		timeLabel,
		placeholder = '',
		disabled = false
	}: {
		/** Goes on the trigger, so a caption's `for` names the whole control. */
		id?: string;
		/** Posts `YYYY-MM-DD`. */
		date: HiddenField;
		/** Posts `HH:MM`. */
		time: HiddenField;
		dateValue?: string;
		timeValue?: string;
		timeLabel: string;
		placeholder?: string;
		disabled?: boolean;
	} = $props();

	const uid = $props.id();
	let open = $state(false);
	let dateInput = $state<HTMLInputElement>();
	let timeInput = $state<HTMLInputElement>();

	// Noon UTC formatted in UTC: the calendar day as picked, whatever the viewer's zone.
	const dayFormat = new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
	const shown = $derived(
		[
			dateValue ? dayFormat.format(new Date(`${dateValue}T12:00:00Z`)) : '',
			timeValue ? formatSlotTime(timeValue) : ''
		]
			.filter(Boolean)
			.join(' · ')
	);

	// The hidden inputs change without an event of their own; one is sent so the
	// form counts the edit and the remote form reads the new value.
	async function announce(el: HTMLInputElement | undefined) {
		await tick();
		el?.dispatchEvent(new Event('input', { bubbles: true }));
	}
</script>

<input {...dateField.as('hidden', dateValue)} bind:this={dateInput} />
<input {...timeField.as('hidden', timeValue)} bind:this={timeInput} />

<Popover.Root bind:open>
	<Popover.Trigger {disabled}>
		{#snippet child({ props })}
			<button
				{...props}
				{id}
				type="button"
				class="input w-full cursor-pointer justify-start text-left"
				data-testid="date-time-trigger"
			>
				<IconCalendar size={20} class="shrink-0 opacity-60" />
				<span class="truncate" class:text-subtle={!shown}>{shown || placeholder}</span>
			</button>
		{/snippet}
	</Popover.Trigger>
	<!-- No Portal: the panel theme is scoped to `[data-panel]`. -->
	<Popover.Content
		sideOffset={4}
		align="start"
		class="z-1000 flex w-[min(19rem,calc(100vw-2rem))] flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
	>
		<Calendar.Root
			type="single"
			weekdayFormat="short"
			fixedWeeks
			bind:value={
				() => (dateValue ? parseDate(dateValue) : undefined),
				(v) => {
					if (!v) return;
					dateValue = v.toString();
					void announce(dateInput);
				}
			}
		>
			{#snippet children({ months, weekdays })}
				<Calendar.Header class="mb-2 flex items-center justify-between">
					<Calendar.PrevButton class="btn btn-square btn-ghost btn-sm">
						<IconChevronLeft size={18} />
					</Calendar.PrevButton>
					<Calendar.Heading class="font-semibold" />
					<Calendar.NextButton class="btn btn-square btn-ghost btn-sm">
						<IconChevronRight size={18} />
					</Calendar.NextButton>
				</Calendar.Header>
				{#each months as month (month.value.toString())}
					<Calendar.Grid class="w-full border-collapse">
						<Calendar.GridHead>
							<Calendar.GridRow class="grid grid-cols-7">
								{#each weekdays as day (day)}
									<Calendar.HeadCell class="text-center text-subtle text-xs"
										>{day}</Calendar.HeadCell
									>
								{/each}
							</Calendar.GridRow>
						</Calendar.GridHead>
						<Calendar.GridBody>
							{#each month.weeks as week, w (w)}
								<Calendar.GridRow class="grid grid-cols-7">
									{#each week as day (day.toString())}
										<Calendar.Cell date={day} month={month.value} class="p-0.5">
											<Calendar.Day
												class="flex aspect-square w-full cursor-pointer items-center justify-center rounded-field text-sm hover:bg-base-200 data-outside-month:opacity-40 data-selected:bg-primary data-selected:text-primary-content data-today:font-bold"
											/>
										</Calendar.Cell>
									{/each}
								</Calendar.GridRow>
							{/each}
						</Calendar.GridBody>
					</Calendar.Grid>
				{/each}
			{/snippet}
		</Calendar.Root>
		<label class="flex items-center justify-between gap-3" for="time-{uid}">
			<span class="text-sm font-semibold">{timeLabel}</span>
			<input
				id="time-{uid}"
				type="time"
				class="input w-36"
				bind:value={timeValue}
				oninput={(e) => {
					// The visible box is unnamed; only the hidden input posts.
					e.stopPropagation();
					void announce(timeInput);
				}}
			/>
		</label>
	</Popover.Content>
</Popover.Root>
