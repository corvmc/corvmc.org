<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconPlus } from '@tabler/icons-svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { suggestionCategories, suggestionCategoryLabels } from '#lib/config.js';
	import { createSuggestion, getMySuggestionStanding } from '#lib/remote/suggestions.remote.js';

	/**
	 * "Suggest something", owning the standing query that decides its wording.
	 *
	 * A member under review posts to staff rather than straight to the board, and both the success
	 * toast and the note inside the form say so. Reading that on the page meant a second remote
	 * query in flight there — see StandingNotice for why composing it into the board query is the
	 * wrong trade.
	 */
	const standing = $derived(await getMySuggestionStanding());
</script>

<Action
	action={createSuggestion}
	label={m.member_suggestions_create_suggestion_new_suggestion()}
	modalTitle={m.member_suggestions_create_suggestion_new_suggestion()}
	submitLabel={m.member_post()}
	successToast={standing.status !== 'none' ? m.member_sent_staff_review() : m.member_posted_board()}
	variant="primary"
	size="sm"
	onsuccess={(r) => {
		if (r && typeof r === 'object' && 'id' in r) {
			void goto(resolve(`/member/suggestions/${r.id as string}`));
		}
	}}
>
	{#snippet icon()}<IconPlus size={16} />{/snippet}
	{#snippet form()}
		{#if standing.status !== 'none'}
			<p class="mb-3 text-muted">{m.member_staff_will_look_at_before()}</p>
		{/if}
		<FormField
			field={createSuggestion.fields.title}
			type="text"
			label={m.member_what_should_we_do()}
		/>
		<FormField
			field={createSuggestion.fields.body}
			type="textarea"
			label={m.member_tell_us_bit_more()}
		/>
		<FormField
			field={createSuggestion.fields.category}
			type="select"
			label={m.member_category()}
			options={suggestionCategories.map((c) => ({
				value: c,
				label: suggestionCategoryLabels[c]
			}))}
		/>
	{/snippet}
</Action>
