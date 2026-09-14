<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { formatDate } from '$lib/utils/format';
	import {
		committeeApplicationQuestions,
		committeeApplicationStatusLabels,
		COMMITTEE_ANSWER_MAX
	} from '$lib/config';
	import {
		applyToCommittees,
		getCommitteeApplyPage,
		withdrawCommitteeApplication
	} from '$lib/remote/committee-applications.remote';

	const fields = applyToCommittees.fields;
	const { fields: withdrawFields } = withdrawCommitteeApplication;

	const pageData = $derived(getCommitteeApplyPage());

	const questionPrompt = (id: string) =>
		committeeApplicationQuestions.find((q) => q.id === id)?.prompt ?? id;

	const statusVariant: Record<string, 'ghost' | 'info' | 'success' | 'error'> = {
		submitted: 'ghost',
		contacted: 'info',
		accepted: 'success',
		declined: 'error'
	};
</script>

<PageHeader title="Committees" subtitle="Volunteering" backHref="/member/volunteer" />

<PageContent>
	<p class="mb-4 text-subtle">
		Committee members attend a monthly meeting and carry ongoing work between meetings. A chair will
		contact you to discuss your application.
	</p>
	{#await pageData then data}
		{#if data.mine.length > 0}
			<InfoCard title="Your applications">
				<div class="space-y-4">
					{#each data.mine as application (application.id)}
						<div class="rounded-box border border-base-300 p-4">
							<div class="mb-2 flex flex-wrap items-center gap-2">
								<span class="text-subtle text-sm">Applied {formatDate(application.createdAt)}</span>
								{#if application.withdrawnAt}
									<Badge variant="ghost">Withdrawn</Badge>
								{/if}
							</div>

							<div class="flex flex-wrap gap-2">
								{#each application.committees as choice (choice.slug)}
									<Badge variant={statusVariant[choice.status] ?? 'ghost'}>
										{choice.name} — {committeeApplicationStatusLabels[choice.status]}
									</Badge>
								{/each}
							</div>

							<!-- The chair's reason, where they left one. Shown because a decision
							     you cannot see is one you cannot ask about. -->
							{#each application.committees.filter((c) => c.reviewNotes) as choice (choice.slug)}
								<p class="mt-2 text-subtle text-sm">
									<strong>{choice.name}:</strong>
									{choice.reviewNotes}
								</p>
							{/each}

							{#if !application.withdrawnAt}
								<div class="mt-3">
									<Action
										action={withdrawCommitteeApplication.for(application.id)}
										label="Withdraw"
										variant="ghost"
										size="xs"
										confirm="Withdraw this application? Anything a chair has already decided stays decided."
										successToast="Application withdrawn"
									>
										{#snippet form()}
											<input {...withdrawFields.applicationId.as('hidden', application.id)} />
										{/snippet}
									</Action>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</InfoCard>
		{/if}

		{#if data.committees.length === 0}
			<EmptyState description="No committees are open to applications right now." />
		{:else}
			<InfoCard title="Apply">
				<Form remote={applyToCommittees} successToast="Application sent" class="space-y-6">
					<CheckboxGroup
						field={fields.groupIds}
						legend="Which committee or committees are you applying to?"
						options={data.committees.map((c) => ({
							value: c.id,
							label: c.name,
							description: c.bio
						}))}
					/>

					<!-- Named rather than looped: `fields` is typed per key, so an index
					     into it is `any`. config.spec.ts pins the two lists together. -->
					<FormField
						field={fields.experience}
						type="textarea"
						label={questionPrompt('experience')}
						maxlength={String(COMMITTEE_ANSWER_MAX)}
					/>
					<FormField
						field={fields.vision}
						type="textarea"
						label={questionPrompt('vision')}
						maxlength={String(COMMITTEE_ANSWER_MAX)}
					/>

					<Alert type="info">
						We already have your name, email and phone from your account — no need to repeat them.
					</Alert>

					<div class="flex justify-end">
						<SubmitButton label="Send application" />
					</div>
				</Form>
			</InfoCard>
		{/if}
	{/await}
</PageContent>
