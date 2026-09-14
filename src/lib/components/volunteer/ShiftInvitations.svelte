<script lang="ts">
	/**
	 * Shifts a coordinator has asked this member to take.
	 *
	 * Above the claim board, because an invitation is addressed to them where
	 * the board is addressed to everybody. Accepting lands `claimed`, not
	 * `confirmed` — saying yes is the member's act and booking is staff's.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { acceptShiftInvitation, declineShiftInvitation } from '$lib/remote/volunteer.remote';

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
	<InfoCard title={invitations.length === 1 ? 'You’ve been asked' : 'You’ve been asked'}>
		<ul class="flex flex-col gap-3">
			{#each invitations as invitation (invitation.signupId)}
				<li class="rounded-lg border border-base-300 p-3">
					<div class="font-medium">{invitation.eventTitle ?? invitation.roleName}</div>
					<div class="text-subtle text-sm">
						{invitation.startsAt ? formatDateShort(invitation.startsAt) : 'date to be set'} ·
						{timeRange(invitation.startsAt, invitation.endsAt)}
						{#if invitation.eventTitle}
							· {invitation.roleName}
						{/if}
					</div>
					{#if invitation.invitedByName}
						<div class="text-subtle text-xs">{invitation.invitedByName} asked</div>
					{/if}
					{#if invitation.notes}
						<p class="mt-1 text-sm">{invitation.notes}</p>
					{/if}

					<div class="mt-2 flex flex-wrap gap-2">
						<Action
							action={acceptShiftInvitation.for(invitation.signupId)}
							label="Yes, I can"
							variant="primary"
							size="xs"
							successToast="Taken. Staff confirm next."
							onsuccess={onchanged}
						>
							{#snippet form()}
								<input {...acceptFields.signupId.as('hidden', invitation.signupId)} />
							{/snippet}
						</Action>
						<Action
							action={declineShiftInvitation.for(invitation.signupId)}
							label="Can't make it"
							variant="ghost"
							size="xs"
							successToast="Thanks for saying — they'll ask somebody else."
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
