<script lang="ts">
	/**
	 * Shifts that finished with a claim nobody ever confirmed.
	 *
	 * These are the silent losses. `complete-shifts` only promotes confirmed signups, so an
	 * unconfirmed claim on a shift that has already happened never completes: the member is
	 * never offered the pre-filled hour log, never asked how it went, and the work they
	 * almost certainly did leaves no trace in the number the board is given.
	 *
	 * Two honest answers, which is why both are offered rather than one:
	 * **they worked it** records the hours and closes it, and **they didn't** marks the
	 * no-show. Doing nothing is the third answer and the one the app used to make for you.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { IconUserX } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE, VOLUNTEER_HOUR_STEP } from '$lib/config';
	import { logHoursForMember, markSignupNoShow } from '$lib/remote/volunteer.remote';
	import type { MemberRef } from '$lib/types/entity';

	type Claim = {
		signupId: string;
		userId: string;
		member: MemberRef;
		shiftId: string;
		volunteerRoleId: string;
		roleName: string;
		startsAt: Date;
		endsAt: Date;
		eventTitle: string | null;
	};

	let { claims }: { claims: Claim[] } = $props();

	function dateInput(d: Date): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(d);
	}

	/** Shift length, rounded to the quarter-hour the log accepts. */
	function shiftHours(startsAt: Date, endsAt: Date): string {
		const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
		return String(Math.round(hours * 4) / 4);
	}
</script>

<InfoCard title="Close these out">
	{#snippet header(title)}
		<CardTitle>
			{title}
			<span class="text-muted font-normal">· {claims.length} from the last week</span>
		</CardTitle>
	{/snippet}

	<p class="text-muted">
		Nobody confirmed these before the shift, so they never completed — no hours were offered and no
		feedback was asked for.
	</p>

	<ul class="flex flex-col gap-3">
		{#each claims as claim (claim.signupId)}
			<li class="flex flex-wrap items-center justify-between gap-3">
				<div class="min-w-0">
					<EntityIdentity ref={claim.member} />
					<div class="text-subtle">
						<a href={resolve(`/staff/volunteer/shifts/${claim.shiftId}`)} class="link">
							{claim.roleName}
						</a>
						· {formatDateShort(claim.startsAt)}
					</div>
				</div>

				<div class="flex shrink-0 items-center gap-1">
					<Action
						action={logHoursForMember.for(claim.signupId)}
						label="They worked it"
						variant="primary"
						size="xs"
						modalTitle="Record hours for {claim.member.title}"
						submitLabel="Record"
						successToast="Hours recorded"
					>
						{#snippet form()}
							<input type="hidden" name="userId" value={claim.userId} />
							<input type="hidden" name="volunteerRoleId" value={claim.volunteerRoleId} />
							<input type="hidden" name="shiftId" value={claim.shiftId} />
							<p class="text-sm">
								{claim.roleName} on {formatDateShort(claim.startsAt)}. Recorded as approved and
								attributed to you.
							</p>
							<FormField
								name="workedOn"
								label="Date"
								type="date"
								value={dateInput(claim.startsAt)}
							/>
							<FormField
								name="hours"
								label="Hours"
								type="number"
								step={VOLUNTEER_HOUR_STEP}
								min="0.25"
								value={shiftHours(claim.startsAt, claim.endsAt)}
								description="Pre-filled from the shift's length."
							/>
							<FormField
								name="description"
								label="What they did"
								type="textarea"
								value="Worked the {claim.roleName} shift"
							/>
						{/snippet}
					</Action>

					<Action
						action={markSignupNoShow.for(claim.signupId)}
						label="No-show"
						iconOnly
						icon={noShowIcon}
						variant="ghost"
						size="sm"
						class="text-error"
						modalTitle="Mark {claim.member.title} as a no-show?"
						submitLabel="No-show"
						submitVariant="error"
						successToast="Marked as no-show"
					>
						{#snippet form()}
							<input type="hidden" name="signupId" value={claim.signupId} />
							<input type="hidden" name="shiftId" value={claim.shiftId} />
							<p class="text-sm">
								Only if they genuinely didn't turn up. If they told you in advance, that was notice
								and not a no-show — take them off the shift instead.
							</p>
						{/snippet}
					</Action>
				</div>
			</li>
		{/each}
	</ul>
</InfoCard>

{#snippet noShowIcon()}
	<IconUserX size={16} />
{/snippet}
