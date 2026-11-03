<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { Select } from '$lib/components/ui/Form';
	import { EntityChip } from '$lib/components/ui/entity';
	import { IconRepeat, IconX } from '@tabler/icons-svelte';
	import { formatTimeRange, formatScheduleLabel, formatDateShortYear } from '$lib/utils/format';
	import { cancelStaffSeries, getStaffRecurring } from '$lib/remote/recurring.remote';

	/**
	 * The recurring series behind the bookings, off the Reservations header
	 * (#1936). A series is the rule that makes bookings, not a booking, so it is
	 * not a row of the list. The query waits for the modal to open; `?recurring`
	 * opens it, which is where the old `/staff/recurring` redirects.
	 */
	const { fields: cancelFields } = cancelStaffSeries;

	let open = $state(page.url.searchParams.has('recurring'));
	let filter = $state<'active' | 'cancelled' | 'all'>('active');
	let pageNo = $state(1);
	const filters = $derived({ filter, page: pageNo });
	const result = $derived(open ? getStaffRecurring(filters) : null);
</script>

<Button variant="ghost" size="sm" onclick={() => (open = true)}>{m.staff_recurring()}</Button>

<Modal bind:open title={m.staff_recurring_series()} maxWidth="max-w-3xl">
	<div class="mb-3 w-40">
		<Select
			size="sm"
			aria-label={m.staff_reservations_recurring_series_modal_aria_label()}
			value={filter}
			onchange={(e: Event) => {
				filter = (e.currentTarget as HTMLSelectElement).value as typeof filter;
				pageNo = 1;
			}}
		>
			<option value="active">{m.staff_active()}</option>
			<option value="cancelled">{m.staff_cancelled()}</option>
			<option value="all">{m.staff_all()}</option>
		</Select>
	</div>
	{#if result}
		<DataList
			{result}
			empty={m.staff_reservations_recurring_series_modal_empty()}
			onpage={(p) => (pageNo = p)}
		>
			{#snippet children(series)}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
						<th>{m.staff_reservations_recurring_series_modal_series()}</th>
						<th>{m.staff_booker()}</th>
						<th class="col-support whitespace-nowrap">{m.staff_starts()}</th>
						<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
					{/snippet}

					{#each series as s (s.id)}
						{@const href = resolve(`/staff/recurring/${s.id}`)}
						<tr>
							<td class="w-px">
								<StatusBadge status={s.cancelledAt ? 'cancelled' : 'active'} />
							</td>
							<td class="cell-primary">
								<a {href} class="flex min-w-0 items-center gap-1 font-medium hover:underline">
									<IconRepeat size={14} class="shrink-0 opacity-60" />
									<span class="truncate">
										{formatScheduleLabel(s.frequencyLabel, s.startsAt, s.monthlyMode)}
									</span>
								</a>
								<div class="truncate text-muted">{formatTimeRange(s.startsAt, s.endsAt)}</div>
							</td>
							<td class="min-w-0"><EntityChip ref={s.booker} /></td>
							<td class="col-support whitespace-nowrap">{formatDateShortYear(s.startsAt)}</td>
							<td class="w-px">
								{#if !s.cancelledAt}
									<Action
										action={cancelStaffSeries}
										label={m.staff_reservations_recurring_series_modal_label()}
										iconOnly
										modalTitle={m.staff_confirm()}
										successToast={m.staff_series_cancelled()}
										onsuccess={() => void getStaffRecurring(filters).refresh()}
										variant="ghost"
										size="sm"
										shape="square"
										class="text-error"
									>
										{#snippet icon()}<IconX size={16} />{/snippet}
										{#snippet form()}
											<input {...cancelFields.seriesId.as('hidden', s.id)} />
											<p class="py-4">
												{m.staff_cancel_recurring_series_next_session()}
											</p>
										{/snippet}
									</Action>
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/snippet}
		</DataList>
	{/if}
</Modal>
