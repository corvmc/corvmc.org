<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import type { MemberRef } from '$lib/types/entity';
	import { formatDate } from '$lib/utils/format';
	import {
		committeeApplicationQuestions,
		committeeApplicationStatusLabels,
		COMMITTEE_ANSWER_MAX,
		type CommitteeApplicationStatus
	} from '$lib/config';
	import {
		acceptCommitteeApplication,
		declineCommitteeApplication,
		markApplicantContacted
	} from '$lib/remote/committee-applications.remote';

	/**
	 * A chair working through their committee's applications.
	 *
	 * Accepting invites rather than seating: being offered a seat and taking one
	 * are two acts, and the invitation is the surface that already says so.
	 */
	let {
		slug,
		applications
	}: {
		slug: string;
		applications: {
			choiceId: string;
			status: CommitteeApplicationStatus;
			submittedAt: Date;
			answers: Record<string, string>;
			applicant: MemberRef;
		}[];
	} = $props();

	const { fields: contactFields } = markApplicantContacted;
	const { fields: acceptFields } = acceptCommitteeApplication;
	const { fields: declineFields } = declineCommitteeApplication;
</script>

{#if applications.length > 0}
	<InfoCard title="Applications">
		{#each applications as application (application.choiceId)}
			<div class="mb-4 rounded-box border border-base-300 p-4 last:mb-0">
				<div class="flex flex-wrap items-center gap-3">
					<EntityIdentity ref={application.applicant} />
					<Badge variant={application.status === 'contacted' ? 'info' : 'ghost'}>
						{committeeApplicationStatusLabels[application.status]}
					</Badge>
					<span class="ml-auto text-subtle text-sm">
						{formatDate(application.submittedAt)}
					</span>
				</div>

				<dl class="mt-3 space-y-3">
					{#each committeeApplicationQuestions as question (question.id)}
						<div>
							<dt class="text-subtle text-sm font-medium">{question.prompt}</dt>
							<!-- Blank is a real answer and says something. The nine applicants
							     migrated from volunteer-role interest have both blank, because
							     that table stored no answers to carry. -->
							<dd class="whitespace-pre-line">
								{application.answers[question.id] || '—'}
							</dd>
						</div>
					{/each}
				</dl>

				<div class="mt-4 flex flex-wrap gap-2">
					{#if application.status === 'submitted'}
						<Action
							action={markApplicantContacted.for(application.choiceId)}
							label="Mark contacted"
							aria-label={`Mark ${application.applicant.title} as contacted`}
							variant="ghost"
							size="xs"
							successToast="Marked contacted"
						>
							{#snippet form()}
								<input {...contactFields.slug.as('hidden', slug)} />
								<input {...contactFields.choiceId.as('hidden', application.choiceId)} />
							{/snippet}
						</Action>
					{/if}
					<Action
						action={acceptCommitteeApplication.for(application.choiceId)}
						label="Accept"
						aria-label={`Accept ${application.applicant.title}`}
						variant="primary"
						size="xs"
						modalTitle="Accept {application.applicant.title}"
						submitLabel="Accept and invite"
						confirm="Accepting invites {application.applicant
							.title} to this committee. They still have to accept the invitation."
						successToast="Accepted — invitation sent"
					>
						{#snippet form()}
							<input {...acceptFields.slug.as('hidden', slug)} />
							<input {...acceptFields.choiceId.as('hidden', application.choiceId)} />
						{/snippet}
					</Action>
					<Action
						action={declineCommitteeApplication.for(application.choiceId)}
						label="Decline"
						aria-label={`Decline ${application.applicant.title}`}
						variant="ghost"
						size="xs"
						modalTitle="Decline {application.applicant.title}"
						submitLabel="Decline"
						successToast="Declined"
					>
						{#snippet form()}
							<input {...declineFields.slug.as('hidden', slug)} />
							<input {...declineFields.choiceId.as('hidden', application.choiceId)} />
							<FormField
								field={declineFields.reviewNotes}
								type="textarea"
								label="Why (optional)"
								maxlength={String(COMMITTEE_ANSWER_MAX)}
								description="The applicant sees this. A decision they cannot see is one nobody can answer a question about later."
							/>
						{/snippet}
					</Action>
				</div>
			</div>
		{/each}
	</InfoCard>
{/if}
