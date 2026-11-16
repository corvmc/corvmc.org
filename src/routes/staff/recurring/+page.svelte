<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import { urlState, oneOf, positiveInt } from '#lib/urlState.svelte.js';
	import StaffViews from '../StaffViews.svelte';
	import { spaceViews } from '../reservations/views';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { Select } from '#lib/components/ui/Form/index.js';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { IconRepeat, IconX } from '@tabler/icons-svelte';
	import { formatTimeRange, formatScheduleLabel, formatDateShortYear } from '#lib/utils/format.js';
	import { cancelStaffSeries, getStaffRecurring } from '#lib/remote/recurring.remote.js';

	/**
	 * The recurring series behind the bookings, a Practice space view (#2766). A
	 * series is the rule that makes bookings, not a booking, so it is not a row of
	 * the reservations list. Each opens its own page.
	 */
	const { fields: cancelFields } = cancelStaffSeries;

	const url = urlState(resolve('staff/recurring'), {
		show: oneOf(['active', 'cancelled', 'all'] as const, 'active'),
		page: positiveInt(1)
	});
	const filters = $derived({ filter: url.show, page: url.page });
	const result = $derived(getStaffRecurring(filters));
</script>

<PageHeader title={m.staff_reservations_practice_space_title()}>
	<StaffViews views={spaceViews} active="recurring" />
</PageHeader>

<PageContent>
	<FilterBar>
		<Select
			size="sm"
			aria-label={m.staff_reservations_recurring_series_modal_aria_label()}
			value={url.show}
			onchange={(e: Event) => {
				url.show = (e.currentTarget as HTMLSelectElement).value as typeof url.show;
				url.page = 1;
			}}
		>
			<option value="active">{m.staff_active_label()}</option>
			<option value="cancelled">{m.staff_cancelled_label()}</option>
			<option value="all">{m.staff_all_label()}</option>
		</Select>
	</FilterBar>
	<DataList
		{result}
		empty={m.staff_reservations_recurring_series_modal_empty_body()}
		onpage={(p) => (url.page = p)}
	>
		{#snippet children(series)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_reservations_recurring_series_modal_series_label()}</th>
					<th>{m.staff_booker_label()}</th>
					<th class="col-support whitespace-nowrap">{m.staff_starts_label()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
				{/snippet}

				{#each series as s (s.id)}
					{@const href = resolve(`staff/recurring/${s.id}`)}
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
									modalTitle={m.staff_confirm_title()}
									successToast={m.staff_series_cancelled_toast()}
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
											{m.staff_cancel_recurring_series_next_session_text()}
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
</PageContent>
