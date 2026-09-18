<script lang="ts">
	/**
	 * Claims on upcoming shifts nobody has confirmed.
	 *
	 * The first card because it is the cheapest thing on this page to get wrong and the
	 * most expensive to leave: only a confirmed signup gets the day-before reminder,
	 * auto-completes, and produces the hour log the member is later asked for. An
	 * unconfirmed claim looks like a staffed shift on every list in the app and quietly
	 * produces none of that (docs/reports/volunteer-workflow-findings.md#a3).
	 *
	 * Grouped by shift, because "confirm everyone on Saturday" is one decision and six
	 * modals was the old cost of it.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { IconCheck } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort, relativeDay } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { confirmSignup, confirmSignups } from '$lib/remote/volunteer.remote';
	import type { MemberRef } from '$lib/types/entity';

	type Claim = {
		signupId: string;
		userId: string;
		member: MemberRef;
		shiftId: string;
		roleName: string;
		startsAt: Date;
		endsAt: Date;
		eventTitle: string | null;
		claimedAt: Date;
	};

	let { claims, total }: { claims: Claim[]; total: number } = $props();

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}

	// Grouped by walking the list, not through a Map — the service already returns claims
	// ordered by the shift's start, so consecutive rows share a shift and the soonest one
	// stays first without any re-sorting. (`svelte/prefer-svelte-reactivity` bans a plain
	// Map here, and a SvelteMap for a value rebuilt from scratch on every change would be
	// reactivity nobody reads.)
	const byShift = $derived.by(() => {
		const groups: { shift: Claim; rows: Claim[] }[] = [];
		for (const claim of claims) {
			const last = groups.at(-1);
			if (last && last.shift.shiftId === claim.shiftId) last.rows.push(claim);
			else groups.push({ shift: claim, rows: [claim] });
		}
		return groups;
	});
</script>

<InfoCard title="Needs confirming" state={total} class="border-l-4 border-warning">
	{#snippet action()}
		<Button href="/staff/volunteer/schedule" variant="ghost" size="sm">Schedule →</Button>
	{/snippet}

	<p class="text-muted">Unconfirmed claims get no reminder and never auto-complete.</p>

	<!-- Zebra off: the group header rows are the banding, which striping
	     muddies. The same choice the reservations and events tables make. -->
	<Table zebra={false}>
		{#snippet head()}
			<th>Member</th>
			<th class="col-support whitespace-nowrap">Claimed</th>
			<th class="w-px"><span class="sr-only">Actions</span></th>
		{/snippet}

		{#each byShift as group (group.shift.shiftId)}
			{@const shift = group.shift}
			<tr class="bg-base-200">
				<th colspan="3" class="font-normal">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<div class="min-w-0">
							<a
								href={resolve(`/staff/volunteer/shifts/${shift.shiftId}`)}
								class="link font-medium"
							>
								{shift.roleName}
							</a>
							<span class="text-muted">
								· {formatDateShort(shift.startsAt)}, {timeRange(shift.startsAt, shift.endsAt)}
							</span>
							{#if shift.eventTitle}
								<span class="text-subtle">· {shift.eventTitle}</span>
							{/if}
						</div>

						{#if group.rows.length > 1}
							<Action
								action={confirmSignups.for(shift.shiftId)}
								label="Confirm all {group.rows.length}"
								variant="ghost"
								size="xs"
								class="text-success"
								modalTitle="Confirm everyone on this shift?"
								submitLabel="Confirm all"
								successToast="Confirmed"
							>
								{#snippet form()}
									<input type="hidden" name="shiftId" value={shift.shiftId} />
									{#each group.rows as row (row.signupId)}
										<input type="hidden" name="signupIds" value={row.signupId} />
									{/each}
									<p class="text-sm">
										{group.rows.map((r) => r.member.title).join(', ')} — all confirmed for
										{shift.roleName} on {formatDateShort(shift.startsAt)}. Each of them gets a
										reminder the day before.
									</p>
								{/snippet}
							</Action>
						{/if}
					</div>
				</th>
			</tr>

			{#each group.rows as claim (claim.signupId)}
				<tr class="hover">
					<td class="cell-primary"><EntityIdentity ref={claim.member} /></td>
					<td class="col-support whitespace-nowrap">
						<Badge variant="ghost" size="xs">{relativeDay(claim.claimedAt)}</Badge>
					</td>
					<td class="w-px">
						<Action
							action={confirmSignup.for(claim.signupId)}
							label="Confirm"
							iconOnly
							icon={checkIcon}
							variant="ghost"
							size="sm"
							class="text-success"
							modalTitle="Confirm {claim.member.title}?"
							submitLabel="Confirm"
							successToast="Confirmed"
						>
							{#snippet form()}
								<input type="hidden" name="signupId" value={claim.signupId} />
								<input type="hidden" name="shiftId" value={claim.shiftId} />
								<p class="text-sm">
									{claim.roleName} on {formatDateShort(claim.startsAt)},
									{timeRange(claim.startsAt, claim.endsAt)}. They'll get a reminder the day before,
									and only a confirmed claim completes afterwards.
								</p>
							{/snippet}
						</Action>
					</td>
				</tr>
			{/each}
		{/each}
	</Table>
</InfoCard>

{#snippet checkIcon()}
	<IconCheck size={16} />
{/snippet}
