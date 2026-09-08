<script lang="ts">
	/**
	 * Work orders — work that needs doing with nobody booked to do it.
	 *
	 * These are the rows with no window. Every forward-looking query on the
	 * volunteering layer filters `starts_at >= now`, and `NULL >= x` is NULL in
	 * SQLite, so an unscheduled row falls out of the member list, the schedule,
	 * the reminder cron and the feedback cron on its own. That is deliberate —
	 * but it also meant nothing anywhere listed them, so the advance half of a
	 * duty list (a `dueOffsetMinutes` item: "Booking Lead, a week out") was
	 * created by `applyDutyList` and then invisible in the whole product.
	 *
	 * Two answers, matching the two the service already offers: **schedule it**,
	 * which gives it a window and turns it into an ordinary claimable shift, and
	 * **close it**, which says the work is done. Closing completes the signups
	 * itself, because the completion cron keys on `ends_at` and can never reach a
	 * row that never had one.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { IconCheck } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort, toLocalDateTime } from '$lib/utils/format';
	import { scheduleWorkOrder, resolveWorkOrder } from '$lib/remote/volunteer.remote';

	type WorkOrder = {
		id: string;
		roleName: string;
		eventTitle: string | null;
		dueAt: Date | null;
		capacity: number;
		claimed: number;
		notes: string | null;
	};

	let { orders }: { orders: WorkOrder[] } = $props();

	const now = Date.now();

	/** Late is derived, never stored — the same rule `contractor_job` follows. */
	function isLate(dueAt: Date | null): boolean {
		return dueAt !== null && dueAt.getTime() < now;
	}

	/**
	 * A sensible window to open the schedule form on: the deadline itself where
	 * there is one, otherwise tomorrow — the anchor the rest of this page uses.
	 */
	function defaultStart(dueAt: Date | null): string {
		return toLocalDateTime(dueAt ?? new Date(now + 86_400_000));
	}

	function defaultEnd(dueAt: Date | null): string {
		const base = (dueAt ?? new Date(now + 86_400_000)).getTime();
		return toLocalDateTime(new Date(base + 2 * 3_600_000));
	}
</script>

<InfoCard title="Needs scheduling">
	{#snippet header(title)}
		<CardTitle>
			{title}
			<span class="text-muted font-normal">· {orders.length}</span>
		</CardTitle>
	{/snippet}

	<p class="text-muted">
		Work with nobody booked to do it. Give it a window and it becomes a shift members can claim.
	</p>

	<ul class="flex flex-col gap-3">
		{#each orders as order (order.id)}
			<li class="flex flex-wrap items-center justify-between gap-3">
				<div class="min-w-0">
					<a href={resolve(`/staff/volunteer/shifts/${order.id}`)} class="link font-medium">
						{order.roleName}
					</a>
					<div class="text-subtle">
						{#if order.eventTitle}
							{order.eventTitle}
						{/if}
						{#if order.dueAt}
							{#if order.eventTitle}·{/if}
							<span class:text-error={isLate(order.dueAt)}>
								{isLate(order.dueAt) ? 'was due' : 'due'}
								{formatDateShort(order.dueAt)}
							</span>
						{:else if !order.eventTitle}
							No deadline
						{/if}
						{#if order.claimed > 0}
							· {order.claimed} of {order.capacity} on it
						{/if}
					</div>
				</div>

				<div class="flex shrink-0 items-center gap-1">
					<Action
						action={scheduleWorkOrder.for(order.id)}
						label="Schedule"
						variant="primary"
						size="xs"
						modalTitle="Find a time for {order.roleName}"
						submitLabel="Schedule"
						successToast="Scheduled"
					>
						{#snippet form()}
							<input type="hidden" name="id" value={order.id} />
							<p class="text-sm">
								Once it has a window it appears on the schedule and members can claim it.
							</p>
							<FormField
								name="startsAt"
								label="Starts"
								type="datetime-local"
								value={defaultStart(order.dueAt)}
							/>
							<FormField
								name="endsAt"
								label="Ends"
								type="datetime-local"
								value={defaultEnd(order.dueAt)}
							/>
						{/snippet}
					</Action>

					<Action
						action={resolveWorkOrder.for(order.id)}
						label="Close it"
						iconOnly
						icon={doneIcon}
						variant="ghost"
						size="sm"
						modalTitle="Close {order.roleName}?"
						submitLabel="Close it"
						successToast="Closed"
					>
						{#snippet form()}
							<input type="hidden" name="id" value={order.id} />
							<p class="text-sm">
								Says the work is finished, which is not the same as anybody having turned up. Anyone
								on it is completed at the same time.
							</p>
							<FormField name="notes" label="What happened" type="textarea" />
						{/snippet}
					</Action>
				</div>
			</li>
		{/each}
	</ul>
</InfoCard>

{#snippet doneIcon()}
	<IconCheck size={16} />
{/snippet}
