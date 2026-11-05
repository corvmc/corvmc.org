<script lang="ts">
	import { Latest } from '#lib/latest.svelte.js';
	import { isRedirect } from '@sveltejs/kit';
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The day-after survey. Reached from the notification/email, so it has to
	 * stand alone: say which shift it's about, take two answers, and cope with
	 * being opened twice.
	 *
	 * The signup id in the URL is not a secret — ownership is enforced
	 * server-side against the session, and a signup that isn't yours (or isn't
	 * completed) renders the not-yours state rather than leaking whose it is.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { RatingGroup } from 'bits-ui';
	import { IconStar, IconStarFilled } from '@tabler/icons-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Form, { Field, SubmitButton } from '#lib/components/ui/Form/index.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { formatDateShort } from '#lib/utils/format.js';
	import { getShiftFeedbackContext, submitShiftFeedback } from '#lib/remote/volunteer.remote.js';

	let signupId = $derived(page.params.signupId!);
	// Not `{#await}`: a refresh would re-pend it and remount the form mid-answer.
	const context = new Latest(() => getShiftFeedbackContext(signupId));
	// A gate's redirect has already navigated by the time it rejects; rethrowing
	// it would flash the error boundary on the way out.
	$effect(() => {
		if (context.error && !isRedirect(context.error.e)) throw context.error.e;
	});

	let submitted = $state(false);
	// The answer comes back from the form rather than being read off the input:
	// the field belongs to the form, and the server is the thing that knows what
	// was actually recorded.
	const setUp = $derived(submitShiftFeedback.result?.wasSetUp ?? null);
</script>

<PageHeader width="md" title={m.member_how_did_go()} subtitle={m.member_volunteering()} />

<PageContent width="md">
	{#if context.current !== undefined}
		{@const ctx = context.current}
		{#if !ctx}
			<EmptyState
				title={m.member_volunteer_feedback_signup_id_nothing_review_here()}
				description={m.member_volunteer_feedback_signup_id_shift_isn_t_yours_hasn()}
				actionLabel={m.member_volunteer_feedback_signup_id_action_label()}
				actionHref="/member/volunteer"
			/>
		{:else if ctx.alreadySubmitted || submitted}
			<InfoCard title={m.member_volunteer_feedback_signup_id_thank()}>
				<!--
					The confirmation answers what they actually said. Somebody who has
					just told us they were not set up to succeed should not be thanked
					in the same words as somebody who was — the first is a complaint,
					and acknowledging it is the least the form owes them.
				-->
				<p class="text-sm">
					{#if !submitted}
						{m.member_volunteer_feedback_signup_id_already_answered_shift()}
					{:else if setUp === false}
						{m.member_volunteer_feedback_signup_id_got_sorry_we_didn_t()}
					{:else}
						{m.member_volunteer_feedback_signup_id_got_thanks_helping_us_ru()}
					{/if}
				</p>
				<a href={resolve('member/volunteer')} class="link text-sm"
					>{m.member_volunteer_feedback_signup_id_action_label()}</a
				>
			</InfoCard>
		{:else}
			<InfoCard
				title={ctx.startsAt ? `${ctx.roleName} — ${formatDateShort(ctx.startsAt)}` : ctx.roleName}
			>
				<Form remote={submitShiftFeedback} onsuccess={() => (submitted = true)}>
					<input {...submitShiftFeedback.fields.signupId.as('hidden', ctx.signupId)} />

					<!-- Label-only wrapper: RatingGroup owns the real `rating` field via its
				     hidden input, and naming the wrapper too double-registers the name. -->
					<Field label={m.member_volunteer_feedback_signup_id_how_did_shift_go()}>
						<!--
							RatingGroup writes the value to a hidden input via `name`, so it
							submits like any other field while the stars stay keyboard- and
							screen-reader-accessible.
						-->
						<RatingGroup.Root
							name={submitShiftFeedback.fields.rating.as('hidden', '').name}
							min={1}
							max={5}
							class="flex gap-1"
						>
							{#snippet children({ items })}
								{#each items as item (item.index)}
									<RatingGroup.Item index={item.index} class="cursor-pointer text-warning">
										{#if item.state === 'active'}
											<IconStarFilled size={28} />
										{:else}
											<IconStar size={28} />
										{/if}
									</RatingGroup.Item>
								{/each}
							{/snippet}
						</RatingGroup.Root>
					</Field>

					<FormField
						field={submitShiftFeedback.fields.wasSetUp}
						type="checkbox"
						label={m.member_volunteer_feedback_signup_id_were_set_up_succeed()}
						checkboxLabel={m.member_volunteer_feedback_signup_id_checkbox_label()}
						description={m.member_volunteer_feedback_signup_id_used_fix_briefing_not_as()}
					/>

					<FormField
						field={submitShiftFeedback.fields.comment}
						type="textarea"
						label={m.member_volunteer_feedback_signup_id_anything_we_should_fix()}
						description={m.member_volunteer_feedback_signup_id_optional_sent_staff_with()}
					/>

					<SubmitButton label={m.member_volunteer_feedback_signup_id_send()} variant="primary" />
				</Form>
			</InfoCard>
		{/if}
	{/if}
</PageContent>
