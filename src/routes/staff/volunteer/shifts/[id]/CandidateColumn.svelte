<script lang="ts">
	/**
	 * "Who to ask" — the shortlist, beside the roster rather than a navigation
	 * away on the role's own page (docs/reports/volunteer-workflow-findings.md#a5).
	 *
	 * Owns `getShiftCandidates` because it is keyed by shift *and* scope, which
	 * no page query could carry: switching the pill has to refetch, and the page
	 * query would have to be re-keyed on a filter the rest of the page ignores.
	 *
	 * Every candidate gets exactly **one** flag line, resolved in priority order.
	 * A row carrying three amber notes says nothing; the top one is the one that
	 * decides whether you can ask this person.
	 */
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { toast } from 'svelte-sonner';
	import { formatDateShort } from '$lib/utils/format';
	import { formatVolunteerHours } from '$lib/config';
	import { assignShiftToMember, getShiftCandidates } from '$lib/remote/volunteer.remote';

	let {
		shiftId,
		roleName,
		startsAt,
		scope = $bindable('interested')
	}: {
		shiftId: string;
		roleName: string;
		startsAt: Date;
		scope?: 'interested' | 'worked' | 'all';
	} = $props();

	const SCOPES = [
		{ key: 'interested', label: 'Interested' },
		{ key: 'worked', label: 'Has worked it' },
		{ key: 'all', label: 'All' }
	] as const;

	// The desk case, kept from the picker this column replaced: somebody walks up
	// and offers, and they are on no shortlist because they never ticked a box.
	// Searching implies "anybody", so it widens the scope on its own rather than
	// making the coordinator press All first and then type.
	let search = $state('');
	const candidates = $derived(
		getShiftCandidates({ shiftId, scope: search ? 'all' : scope, search: search || undefined })
	);

	type Row = Awaited<ReturnType<typeof getShiftCandidates>>['rows'][number];

	/**
	 * The one line under a candidate's name, and whether they can be added.
	 *
	 * Order is the whole point: a missing clearance is a refusal the service
	 * will make anyway, so it outranks a warning, which outranks a hint about
	 * the day, which outranks the ordinary case.
	 */
	function flag(row: Row): { tone: string; text: string; blocked: boolean } {
		if (row.missing.length > 0) {
			const names = row.missing.map((m) => m.name).join(' and ');
			return { tone: 'text-error', text: `Needs ${names}`, blocked: true };
		}
		if (row.lapsing.length > 0) {
			return {
				tone: 'text-warning',
				text: `${row.lapsing.join(' and ')} lapses soon after ${formatDateShort(startsAt)}`,
				blocked: false
			};
		}
		if (row.dayMismatch) {
			return { tone: 'text-warning', text: 'Day may not suit — read their note', blocked: false };
		}
		if (row.cleared.length > 0) {
			return {
				tone: 'text-subtle',
				text: `Cleared for ${row.cleared.join(' and ')} on ${formatDateShort(startsAt)}`,
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

	function refuse(row: Row) {
		toast.error(
			`Refused. ${row.missing.map((m) => m.name).join(' and ')} is required for ${roleName}.`
		);
	}
</script>

<InfoCard title="Who to ask">
	{#snippet header()}
		<div class="flex flex-col gap-2">
			{#await candidates then result}
				<CardTitle>Who to ask · {result.rows.length}</CardTitle>
			{/await}
			<!-- Says which date the clearances were judged against, because "cleared"
			     without a date is the bug this column exists to fix: a card valid
			     today does not cover a shift the week after it lapses. -->
			<p class="text-subtle text-xs">Cleared as of {formatDateShort(startsAt)}.</p>
			<SearchInput bind:value={search} placeholder="Search by name or email" />
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

	{#await candidates then result}
		{#if result.rows.length === 0}
			<EmptyState
				title="Nobody left in this group"
				description={search
					? 'Nobody matches that who is not already on the shift.'
					: scope === 'all'
						? 'Everybody with a volunteer profile is already on this shift.'
						: 'Try All.'}
			/>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each result.rows as row (row.userId)}
					{@const f = flag(row)}
					<li class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0">
							<EntityIdentity ref={row.member} />
							<div class="truncate text-subtle text-xs">
								{row.availability || "Hasn't said when they're free"}
							</div>
							<div class="{f.tone} truncate text-xs">{f.text}</div>
						</div>

						{#if f.blocked}
							<!-- Reads Blocked and refuses on press rather than vanishing:
							     the coordinator's useful next step is to go and grant the
							     thing, and a candidate who silently disappeared teaches
							     them nothing. -->
							<Button size="xs" variant="ghost" class="text-error" onclick={() => refuse(row)}>
								Blocked
							</Button>
						{:else}
							<Action
								action={assignShiftToMember.for(`${shiftId}:${row.userId}`)}
								label="Add"
								variant="ghost"
								size="xs"
								modalTitle="Put {row.member.title} on this shift?"
								submitLabel="Add them"
								successToast="Added. They're booked."
							>
								{#snippet form()}
									<input type="hidden" name="shiftId" value={shiftId} />
									<input type="hidden" name="userId" value={row.userId} />
									<p class="text-sm">
										A staff add is a booking, not a claim — {row.member.title} lands confirmed, gets the
										reminder the day before, and the shift completes afterwards with hours to log.
									</p>
								{/snippet}
							</Action>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/await}
</InfoCard>
