<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	/**
	 * "Who to ask": the shortlist beside the roster, judged on the shift's date.
	 * Owns `getShiftCandidates` because it is keyed by shift *and* scope, which
	 * the page query does not carry. Each candidate gets one flag line, the
	 * highest-priority one: it decides whether you can ask this person.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { toast } from 'svelte-sonner';
	import { formatDateShort } from '#lib/utils/format.js';
	import { formatVolunteerHours } from '#lib/config.js';
	import { Latest } from '#lib/latest.svelte.js';
	import {
		assignShiftToMember,
		inviteMemberToShift,
		getShiftCandidates
	} from '#lib/remote/volunteer.remote.js';

	let {
		workOrderId,
		shiftId,
		startsAt,
		scope = $bindable('interested')
	}: {
		workOrderId: string;
		/** The task's current shift. Null for a task with none: Add assigns the task. */
		shiftId: string | null;
		/** Null for a task with no shift — clearance is judged as of today. */
		startsAt: Date | null;
		scope?: 'interested' | 'worked' | 'all';
	} = $props();

	/** A staff add goes through over a missing profile or clearance; say what it went over. */
	function warnOver(result?: unknown) {
		const warnings = (result as { warnings?: string[] } | undefined)?.warnings ?? [];
		if (warnings.length > 0)
			toast.warning(msg.volunteer_candidate_column_toast({ join: warnings.join(' ') }));
	}

	const SCOPES = [
		{ key: 'interested', label: msg.volunteer_candidate_column_interested_label() },
		{ key: 'worked', label: msg.volunteer_candidate_column_has_worked_label() },
		{ key: 'all', label: msg.volunteer_candidate_column_all_label() }
	] as const;

	// The desk case, kept from the picker this column replaced: somebody walks up
	// and offers, and they are on no shortlist because they never ticked a box.
	// Searching implies "anybody", so it widens the scope on its own rather than
	// making the coordinator press All first and then type.
	let search = $state('');
	// Not `{#await}`: a refresh would re-pend it and unmount an open Invite or Add.
	const candidates = new Latest(() =>
		getShiftCandidates({
			workOrderId,
			scope: search ? 'all' : scope,
			search: search || undefined
		})
	);
	$effect(() => {
		if (candidates.error) throw candidates.error.e;
	});

	type Row = Awaited<ReturnType<typeof getShiftCandidates>>['rows'][number];

	/**
	 * The one line under a candidate's name, and whether they can be added.
	 *
	 * Order is the whole point: a missing clearance is the gap an add is recorded
	 * going over, so it outranks a lapsing card, which outranks a hint about the
	 * day, which outranks a skill match, which outranks the ordinary case.
	 */
	function flag(row: Row): { tone: string; text: string; blocked: boolean } {
		if (row.missing.length > 0) {
			const names = row.missing.map((m) => m.name).join(' and ');
			return { tone: 'text-error', text: `Not cleared: needs ${names}`, blocked: true };
		}
		if (row.lapsing.length > 0) {
			return {
				tone: 'text-warning',
				text: `${row.lapsing.join(' and ')} lapses soon${
					startsAt ? ` after ${formatDateShort(startsAt)}` : ''
				}`,
				blocked: false
			};
		}
		if (row.dayMismatch) {
			return { tone: 'text-warning', text: 'Day may not suit — read their note', blocked: false };
		}
		// Why they ranked where they did (#1445), set on the role's page.
		if (row.matchedSkills.length > 0) {
			return {
				tone: 'text-subtle',
				text: `Skills: ${row.matchedSkills.join(', ')}`,
				blocked: false
			};
		}
		if (row.cleared.length > 0) {
			return {
				tone: 'text-subtle',
				text: `Cleared for ${row.cleared.join(' and ')}${
					startsAt ? ` on ${formatDateShort(startsAt)}` : ''
				}`,
				blocked: false
			};
		}
		const hours = formatVolunteerHours(row.approvedMinutes);
		return {
			tone: 'text-subtle',
			text:
				row.workedThisRole > 0
					? `${hours} logged · ${row.workedThisRole} of these before`
					: `${hours} logged`,
			blocked: false
		};
	}

	/**
	 * Cleared first, not cleared last, and the two counted apart: a heading that
	 * counted the uncleared said "Who to ask · 2" over nobody askable (#1236).
	 */
	function grade(rows: Row[]) {
		const graded = rows.map((row) => ({ row, f: flag(row) }));
		return {
			ordered: graded.toSorted((a, b) => Number(a.f.blocked) - Number(b.f.blocked)),
			askable: graded.filter((g) => !g.f.blocked).length,
			blocked: graded.filter((g) => g.f.blocked).length
		};
	}
</script>

<InfoCard title={msg.volunteer_candidate_column_who_ask_title()}>
	{#snippet header()}
		<div class="flex flex-col gap-2">
			{#if candidates.current}
				{@const g = grade(candidates.current.rows)}
				<CardTitle>
					{msg.volunteer_candidate_column_who_ask_2_title({ askable: g.askable })}
					{#if g.blocked > 0}
						<span class="text-subtle text-sm font-normal"
							>{msg.volunteer_candidate_column_not_cleared_title({ blocked: g.blocked })}</span
						>
					{/if}
				</CardTitle>
			{/if}
			<!-- Says which date the clearances were judged against, because "cleared"
			     without a date is the bug this column exists to fix: a card valid
			     today does not cover a shift the week after it lapses. -->
			<p class="text-subtle text-xs">
				{msg.volunteer_candidate_column_cleared_as_text({
					value: startsAt ? formatDateShort(startsAt) : msg.volunteer_candidate_column_today_text()
				})}
			</p>
			<SearchInput bind:value={search} placeholder={msg.volunteer_candidate_column_placeholder()} />
			<div class="flex flex-wrap gap-1" class:opacity-50={!!search}>
				{#each SCOPES as s (s.key)}
					<Button
						size="xs"
						variant={scope === s.key ? 'primary' : 'ghost'}
						onclick={() => (scope = s.key)}
					>
						{s.label}
					</Button>
				{/each}
			</div>
		</div>
	{/snippet}

	{#if candidates.current}
		{@const result = candidates.current}
		{@const g = grade(result.rows)}
		{#if result.rows.length === 0}
			<EmptyState
				title={msg.volunteer_candidate_column_nobody_left_group_title()}
				description={search
					? msg.volunteer_candidate_column_nobody_matches_who_not_already_body()
					: scope === 'all'
						? msg.volunteer_candidate_column_everybody_with_volunteer_profile_body()
						: msg.volunteer_candidate_column_try_all_body()}
			/>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each g.ordered as { row, f } (row.userId)}
					<li class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0">
							<EntityIdentity ref={row.member} />
							<div class="truncate text-subtle text-xs">
								{row.availability || msg.volunteer_candidate_column_hasn_t_said_when_they_text()}
							</div>
							<div class="{f.tone} truncate text-xs">{f.text}</div>
						</div>

						<!-- Two verbs on purpose. Invite asks and holds no place, so the
						     shift keeps reading short-staffed until somebody answers;
						     Add books them, which is what a coordinator who has already
						     spoken to them means. -->
						<!-- An invitation is to a shift; a task with none is assigned. -->
						{#if shiftId}
							<Action
								action={inviteMemberToShift.for(`${shiftId}:${row.userId}`)}
								label={msg.volunteer_candidate_column_invite_label()}
								variant="primary"
								size="xs"
								modalTitle={msg.volunteer_candidate_column_ask_take_title({
									title: row.member.title
								})}
								submitLabel={msg.volunteer_candidate_column_send_invitation_label()}
								successToast={msg.volunteer_candidate_column_asked_they_ll_see_their_toast()}
							>
								{#snippet form()}
									<input
										{...inviteMemberToShift
											.for(`${shiftId}:${row.userId}`)
											.fields.shiftId.as('hidden', shiftId)}
									/>
									<input
										{...inviteMemberToShift
											.for(`${shiftId}:${row.userId}`)
											.fields.userId.as('hidden', row.userId)}
									/>
									<p class="text-sm">
										{msg.volunteer_candidate_column_invitation_holds_no_place_shift_text({
											title: row.member.title
										})}
									</p>
								{/snippet}
							</Action>
						{/if}
						<Action
							action={assignShiftToMember.for(`${workOrderId}:${row.userId}`)}
							label={msg.volunteer_candidate_column_add_label()}
							data-testid="assign-candidate"
							variant="ghost"
							size="xs"
							modalTitle={msg.volunteer_candidate_column_put_shift_title({
								title: row.member.title
							})}
							submitLabel={msg.volunteer_candidate_column_add_them_label()}
							successToast={msg.volunteer_candidate_column_added_they_re_booked_toast()}
							onsuccess={warnOver}
						>
							{#snippet form()}
								<input
									{...assignShiftToMember
										.for(`${workOrderId}:${row.userId}`)
										.fields.workOrderId.as('hidden', workOrderId)}
								/>
								{#if shiftId}
									<input
										{...assignShiftToMember
											.for(`${workOrderId}:${row.userId}`)
											.fields.shiftId.as('hidden', shiftId)}
									/>
								{/if}
								<input
									{...assignShiftToMember
										.for(`${workOrderId}:${row.userId}`)
										.fields.userId.as('hidden', row.userId)}
								/>
								<p class="text-sm">
									{msg.volunteer_candidate_column_staff_add_booking_not_claim_text({
										title: row.member.title
									})}
								</p>
								{#if f.blocked}
									<p class="text-sm text-error">
										{msg.volunteer_candidate_column_missing_clearance_text({
											names: new Intl.ListFormat('en').format(row.missing.map((m) => m.name))
										})}
									</p>
								{/if}
							{/snippet}
						</Action>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</InfoCard>
