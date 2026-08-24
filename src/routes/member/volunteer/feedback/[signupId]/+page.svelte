<script lang="ts">
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
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Form, { Field, SubmitButton } from '$lib/components/shared/Form';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { getShiftFeedbackContext, submitShiftFeedback } from '$lib/remote/volunteer.remote';

	let signupId = $derived(page.params.signupId!);
	let context = $derived(getShiftFeedbackContext(signupId));

	let submitted = $state(false);
</script>

<PageHeader title="How did it go?" subtitle="Volunteering" backHref="/member/volunteer" />

<PageContent width="md">
	{#await context then ctx}
		{#if !ctx}
			<EmptyState
				title="Nothing to review here"
				description="This shift isn't yours, or it hasn't finished yet."
				actionLabel="Back to volunteering"
				actionHref="/member/volunteer"
			/>
		{:else if ctx.alreadySubmitted || submitted}
			<InfoCard title="Thank you">
				<p class="text-sm">
					{submitted
						? 'Got it — thanks for helping us run the next one better.'
						: 'You already answered for this shift.'}
				</p>
				<a href={resolve('/member/volunteer')} class="link text-sm">Back to volunteering</a>
			</InfoCard>
		{:else}
			<InfoCard title="{ctx.roleName} — {formatDateShort(ctx.startsAt)}">
				<Form remote={submitShiftFeedback} onsuccess={() => (submitted = true)}>
					<input type="hidden" name="signupId" value={ctx.signupId} />

					<!-- Label-only wrapper: RatingGroup owns the real `rating` field via its
				     hidden input, and naming the wrapper too double-registers the name. -->
					<Field label="How did the shift go?">
						<!--
							RatingGroup writes the value to a hidden input via `name`, so it
							submits like any other field while the stars stay keyboard- and
							screen-reader-accessible.
						-->
						<RatingGroup.Root name="rating" min={1} max={5} class="flex gap-1">
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
						name="wasSetUp"
						type="checkbox"
						label="Were you set up to succeed?"
						checkboxLabel="I knew what to do and had what I needed"
						description="Answer honestly — a no here fixes the briefing for the next person, not you."
					/>

					<FormField
						name="comment"
						type="textarea"
						label="Anything we should fix?"
						description="Optional. Goes to staff without your name attached to the rollup."
					/>

					<SubmitButton label="Send it" variant="primary" />
				</Form>
			</InfoCard>
		{/if}
	{/await}
</PageContent>
