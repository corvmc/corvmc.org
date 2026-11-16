<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { updateTeachingTerms } from '#lib/remote/settings.remote.js';
	import TeachingTermsFields from './TeachingTermsFields.svelte';

	/**
	 * What a teacher pays for the room and how far ahead they book. Stored with
	 * the reservation config, set here because it is the teaching module's.
	 */
	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

{#if hasCapability(caps, 'settings.update')}
	<Action
		action={updateTeachingTerms}
		label={m.staff_members_instructors_teaching_terms_edit_label()}
		modalTitle={m.staff_members_instructors_teaching_terms_edit_title()}
		submitLabel={m.staff_settings_save_label()}
		successToast={m.staff_members_instructors_teaching_terms_saved_toast()}
		variant="ghost"
		size="sm"
	>
		{#snippet form()}
			<TeachingTermsFields />
		{/snippet}
	</Action>
{/if}
