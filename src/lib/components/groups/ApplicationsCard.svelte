<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import type { MemberRef } from '#lib/types/entity.js';
	import { formatDate } from '#lib/utils/format.js';
	import {
		groupApplicationQuestions,
		groupApplicationStatusLabels,
		APPLICATION_ANSWER_MAX,
		type ApplicationGroupKind,
		type GroupApplicationStatus
	} from '#lib/config.js';
	import {
		acceptGroupApplication,
		declineGroupApplication,
		markApplicantContacted
	} from '#lib/remote/group-applications.remote.js';

	/**
	 * A reviewer working through one group's applications, whatever its kind.
	 *
	 * Accepting invites rather than seating (#1729): being offered a seat and
	 * taking one are two acts, and the invitation is the surface that says so.
	 */
	let {
		slug,
		kind,
		title = m.groups_applications_card_title(),
		applications
	}: {
		slug: string;
		kind: ApplicationGroupKind;
		/** Named when several groups stack on one page. */
		title?: string;
		applications: {
			choiceId: string;
			status: GroupApplicationStatus;
			submittedAt: Date;
			answers: Record<string, string>;
			applicant: MemberRef;
		}[];
	} = $props();

	const questions = $derived(groupApplicationQuestions[kind]);
	const { fields: contactFields } = markApplicantContacted;
	const { fields: acceptFields } = acceptGroupApplication;
	const { fields: declineFields } = declineGroupApplication;
</script>

{#if applications.length > 0}
	<InfoCard {title}>
		{#each applications as application (application.choiceId)}
			<div class="mb-4 rounded-box border border-base-300 p-4 last:mb-0">
				<div class="flex flex-wrap items-center gap-3">
					<EntityIdentity ref={application.applicant} />
					<Badge variant={application.status === 'contacted' ? 'info' : 'ghost'}>
						{groupApplicationStatusLabels[application.status]}
					</Badge>
					<span class="ml-auto text-subtle text-sm">
						{formatDate(application.submittedAt)}
					</span>
				</div>

				<dl class="mt-3 space-y-3">
					{#each questions as question (question.id)}
						<div>
							<dt class="text-subtle text-sm font-medium">{question.prompt}</dt>
							<!-- Blank is a real answer. Requests migrated from the old roster
							     status carried none, so they read blank here. -->
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
							label={m.groups_applications_card_mark_contacted_label()}
							aria-label={m.groups_applications_card_mark_as_contacted_label({
								title: application.applicant.title
							})}
							variant="ghost"
							size="xs"
							successToast={m.groups_applications_card_marked_contacted_toast()}
						>
							{#snippet form()}
								<input {...contactFields.slug.as('hidden', slug)} />
								<input {...contactFields.choiceId.as('hidden', application.choiceId)} />
							{/snippet}
						</Action>
					{/if}
					<Action
						action={acceptGroupApplication.for(application.choiceId)}
						label={m.groups_accept_label()}
						aria-label={m.groups_applications_card_accept_label({
							title: application.applicant.title
						})}
						variant="primary"
						size="xs"
						modalTitle={m.groups_applications_card_accept_title({
							title: application.applicant.title
						})}
						submitLabel={m.groups_applications_card_accept_invite_label()}
						confirm={m.groups_applications_card_confirm_body({
							title: application.applicant.title
						})}
						successToast={m.groups_applications_card_accepted_invitation_sent_toast()}
					>
						{#snippet form()}
							<input {...acceptFields.slug.as('hidden', slug)} />
							<input {...acceptFields.choiceId.as('hidden', application.choiceId)} />
						{/snippet}
					</Action>
					<Action
						action={declineGroupApplication.for(application.choiceId)}
						label={m.groups_decline_label()}
						aria-label={m.groups_applications_card_decline_label({
							title: application.applicant.title
						})}
						variant="ghost"
						size="xs"
						modalTitle={m.groups_applications_card_decline_title({
							title: application.applicant.title
						})}
						submitLabel={m.groups_decline_label()}
						successToast={m.groups_applications_card_declined_toast()}
					>
						{#snippet form()}
							<input {...declineFields.slug.as('hidden', slug)} />
							<input {...declineFields.choiceId.as('hidden', application.choiceId)} />
							<FormField
								field={declineFields.reviewNotes}
								type="textarea"
								label={m.groups_applications_card_why_optional_label()}
								maxlength={String(APPLICATION_ANSWER_MAX)}
								description={m.groups_applications_card_description_body()}
							/>
						{/snippet}
					</Action>
				</div>
			</div>
		{/each}
	</InfoCard>
{/if}
