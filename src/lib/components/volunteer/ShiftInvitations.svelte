<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Shifts a coordinator has asked this member to take.
	 *
	 * Above the claim board, because an invitation is addressed to them where
	 * the board is addressed to everybody. Accepting lands `claimed`, not
	 * `confirmed` — saying yes is the member's act and booking is staff's.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import { acceptShiftInvitation, declineShiftInvitation } from '#lib/remote/volunteer.remote.js';

	let {
		invitations,
		onchanged
	}: {
		invitations: {
			signupId: string;
			roleName: string;
			eventTitle: string | null;
			startsAt: Date | null;
			endsAt: Date | null;
			notes: string | null;
			invitedByName: string | null;
		}[];
		onchanged?: () => void;
	} = $props();

	const { fields: acceptFields } = acceptShiftInvitation;
	const { fields: declineFields } = declineShiftInvitation;

	function timeRange(startsAt: Date | null, endsAt: Date | null): string {
		if (!startsAt || !endsAt) return 'time to be set';
		const fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: DEFAULT_TIMEZONE,
			hour: 'numeric',
			minute: '2-digit'
		});
		return `${fmt.format(startsAt)}–${fmt.format(endsAt)}`;
	}
</script>

{#if invitations.length > 0}
	<InfoCard
		title={invitations.length === 1
			? m.volunteer_shift_invitations_title()
			: m.volunteer_shift_invitations_title()}
	>
		<ul class="flex flex-col gap-3">
			{#each invitations as invitation (invitation.signupId)}
				<li class="rounded-lg border border-base-300 p-3">
					<div class="font-medium">{invitation.eventTitle ?? invitation.roleName}</div>
					<div class="text-subtle text-sm">
						{invitation.startsAt
							? formatDateShort(invitation.startsAt)
							: m.volunteer_shift_invitations_date_set_text()} ·
						{timeRange(invitation.startsAt, invitation.endsAt)}
						{#if invitation.eventTitle}
							· {invitation.roleName}
						{/if}
					</div>
					{#if invitation.invitedByName}
						<div class="text-subtle text-xs">
							{m.volunteer_asked_text({ invitedByName: invitation.invitedByName })}
						</div>
					{/if}
					{#if invitation.notes}
						<p class="mt-1 text-sm">{invitation.notes}</p>
					{/if}

					<div class="mt-2 flex flex-wrap gap-2">
						<Action
							action={acceptShiftInvitation.for(invitation.signupId)}
							label={m.volunteer_shift_invitations_yes_i_can_label()}
							variant="primary"
							size="xs"
							successToast={m.volunteer_shift_invitations_taken_staff_confirm_next_toast()}
							onsuccess={onchanged}
						>
							{#snippet form()}
								<input {...acceptFields.signupId.as('hidden', invitation.signupId)} />
							{/snippet}
						</Action>
						<Action
							action={declineShiftInvitation.for(invitation.signupId)}
							label={m.volunteer_shift_invitations_can_t_make_label()}
							variant="ghost"
							size="xs"
							successToast={m.volunteer_shift_invitations_thanks_saying_they_ll_ask_toast()}
							onsuccess={onchanged}
						>
							{#snippet form()}
								<input {...declineFields.signupId.as('hidden', invitation.signupId)} />
							{/snippet}
						</Action>
					</div>
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}
