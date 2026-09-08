<script lang="ts">
	/**
	 * Where a snoozed thread goes, and when it comes back.
	 *
	 * Presets carry the date they resolve to rather than a label the server has to
	 * re-derive — picking "Next Monday" *is* picking a date, and two independent
	 * derivations of "next Monday" is one too many.
	 *
	 * The last option is not a date at all. "When they reply" is the awaiting-reply
	 * marker, which is the same state the default send applies: the thread leaves
	 * the queue now and returns the moment the contact writes back. It lives here
	 * because from the user's side it is the same decision — when do I want to see
	 * this again — and the answer is sometimes a condition rather than a day.
	 */
	import { DropdownMenu } from 'bits-ui';
	import { IconAlarmSnooze, IconCalendar, IconSend } from '@tabler/icons-svelte';
	import { snoozePresets } from './snooze-presets';

	let {
		open = $bindable(false),
		onpick,
		onwait,
		children
	}: {
		/**
		 * Bound so a keyboard shortcut on the trigger's owner can open the menu.
		 * Clicking the trigger still opens it without anyone binding this.
		 */
		open?: boolean;
		/** A calendar date, `yyyy-MM-dd`. */
		onpick: (date: string) => void;
		/** "When they reply" — the conditional option, no date involved. */
		onwait: () => void;
		/** The trigger. Rendered by the caller so the bar owns its own styling. */
		children: import('svelte').Snippet<[{ props: Record<string, unknown> }]>;
	} = $props();

	const presets = $derived.by(() => snoozePresets(new Date()));

	// The custom date lives in the menu rather than behind a second modal: it is
	// one more option in the same list, and pushing it into a dialog made the
	// common case (a preset) and the uncommon one (a date) feel equally heavy.
	let custom = $state('');
	const itemClass =
		'flex w-full cursor-pointer items-center justify-between gap-6 rounded-box px-3 py-2 text-sm data-highlighted:bg-base-200';
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}{@render children({ props })}{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			sideOffset={4}
			align="end"
			class="z-[1000] min-w-64 rounded-lg border border-base-300 bg-base-100 p-2 shadow-lg"
		>
			<p class="px-3 pt-1 pb-2 text-subtle text-xs">Snooze until</p>

			{#each presets as preset (preset.label)}
				<DropdownMenu.Item class={itemClass} onSelect={() => onpick(preset.value)}>
					<span class="flex items-center gap-2"><IconAlarmSnooze size={15} />{preset.label}</span>
					<span class="text-subtle text-xs">{preset.when}</span>
				</DropdownMenu.Item>
			{/each}

			<!-- `closeOnSelect={false}`: selecting here means "I am about to type a
			     date", and closing the menu on the first click would make the field
			     unreachable. -->
			<DropdownMenu.Item
				class={itemClass}
				closeOnSelect={false}
				onSelect={(e) => e.preventDefault()}
			>
				<span class="flex items-center gap-2"><IconCalendar size={15} />Pick a date</span>
				<input
					type="date"
					class="input w-32 input-xs"
					aria-label="Snooze until a date"
					bind:value={custom}
					onchange={() => custom && onpick(custom)}
				/>
			</DropdownMenu.Item>

			<div class="my-1 border-t border-base-300"></div>

			<DropdownMenu.Item class={itemClass} onSelect={onwait}>
				<span class="flex items-center gap-2"><IconSend size={15} />When they reply</span>
			</DropdownMenu.Item>
			<p class="px-3 pt-1 pb-1 text-subtle text-xs">
				Leaves the queue now, comes back the moment they respond.
			</p>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
