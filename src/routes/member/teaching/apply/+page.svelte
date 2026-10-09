<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { applyToTeach } from '$lib/remote/instructors.remote';

	// Its own page, not a card on the profile, so applying is a step a member
	// takes on purpose (#1820). Nothing here awaits: a top-level await would
	// async-gate every `fields` expression below.
	const fields = applyToTeach.fields;
</script>

<PageHeader
	width="3xl"
	subtitle="Teaching"
	title="Apply to teach"
	backHref={resolve('/member/profile')}
/>
<PageContent width="3xl">
	<InfoCard title="Your application">
		<p class="mb-4 text-subtle">
			Teachers book the room at the member rate without the monthly cap, and appear in the teacher
			directory. Staff review what you write here, and it becomes your listing.
		</p>

		<Form
			remote={applyToTeach}
			successToast="Application sent"
			onsuccess={() => goto(resolve('/member/profile'))}
		>
			<FormField field={fields.headline} label="What do you teach?" required />
			<FormField field={fields.blurb} label="About your teaching" type="textarea" required />
			<FormField field={fields.ratesNote} label="Your rates (shown as written)" />
			<FormField field={fields.bookingUrl} label="Where students book you (optional)" />
			<FormField
				field={fields.applicationNote}
				label="Anything staff should know? (not published)"
				type="textarea"
			/>
			<SubmitButton>Send application</SubmitButton>
		</Form>
	</InfoCard>
</PageContent>
