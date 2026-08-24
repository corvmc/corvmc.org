<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import { EntityChip } from '$lib/components/shared/entity';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { IconRepeat, IconX } from '@tabler/icons-svelte';
	import {
		formatTimeRange,
		formatDuration,
		formatScheduleLabel,
		formatDateShortYear
	} from '$lib/utils/format';
	import { cancelStaffSeries, getStaffRecurring } from '$lib/remote/recurring.remote';
	const { fields: cancelFields } = cancelStaffSeries;

	let filter = $state<'active' | 'cancelled' | 'all'>('active');
	let page = $state(1);

	let filters = $derived({ filter, page });
	let result = $derived(getStaffRecurring(filters));
</script>

<PageHeader title="Recurring Reservations" />
<PageContent>
	<div class="flex items-center gap-2 mb-4">
		<Button
			variant={filter === 'active' ? 'primary' : 'ghost'}
			size="sm"
			onclick={() => {
				filter = 'active';
				page = 1;
			}}
		>
			Active
		</Button>
		<Button
			variant={filter === 'cancelled' ? 'primary' : 'ghost'}
			size="sm"
			onclick={() => {
				filter = 'cancelled';
				page = 1;
			}}
		>
			Cancelled
		</Button>
		<Button
			variant={filter === 'all' ? 'primary' : 'ghost'}
			size="sm"
			onclick={() => {
				filter = 'all';
				page = 1;
			}}
		>
			All
		</Button>
	</div>

	<DataList {result} empty="No recurring series found" onpage={(p) => (page = p)}>
		{#snippet children(series)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Series</th>
					<th>Booker</th>
					<th class="col-support whitespace-nowrap">Starts</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}

				{#each series as s (s.id)}
					{@const href = resolve(`/staff/recurring/${s.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={s.cancelledAt ? 'cancelled' : 'active'} />
						</td>
						<!-- Schedule is the identity of a series and the time range
						     qualifies it; whose series it is gets its own column. Created
						     dropped to the detail page. -->
						<td class="cell-primary">
							<a {href} class="flex min-w-0 items-center gap-1 font-medium hover:underline">
								<IconRepeat size={14} class="shrink-0 opacity-60" />
								<span class="truncate">
									{formatScheduleLabel(s.frequencyLabel, s.startsAt, s.monthlyMode)}
								</span>
							</a>
							<div class="truncate text-muted">
								{formatTimeRange(s.startsAt, s.endsAt)} · {formatDuration(s.startsAt, s.endsAt)}
							</div>
						</td>
						<!-- Member, band or event, exactly as on the bookings the series
						     generates — the chip's glyph is what says which. -->
						<td class="min-w-0"><EntityChip ref={s.booker} /></td>
						<td class="col-support whitespace-nowrap">{formatDateShortYear(s.startsAt)}</td>
						<td class="w-px">
							{#if !s.cancelledAt}
								<Action
									action={cancelStaffSeries}
									label="Cancel series"
									iconOnly
									modalTitle="Confirm"
									successToast="Series cancelled"
									onsuccess={() => {
										void getStaffRecurring(filters).refresh();
									}}
									variant="ghost"
									size="sm"
									shape="square"
									class="text-error"
								>
									{#snippet icon()}<IconX size={16} />{/snippet}
									{#snippet form()}
										<input {...cancelFields.seriesId.as('hidden', s.id)} />
										<p class="py-4">
											Cancel this recurring series? Future reservations will not be created.
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
