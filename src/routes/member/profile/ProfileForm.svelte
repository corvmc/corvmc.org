<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import { saveMemberProfile } from '#lib/remote/directory.remote.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import FileUpload from '#lib/components/ui/Form/FileUpload.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EntityAvatar from '#lib/components/ui/entity/EntityAvatar.svelte';
	import FreeformTagInput from '#lib/components/ui/FreeformTagInput.svelte';
	import RichTextEditor from '#lib/components/ui/Form/RichTextEditor.svelte';
	import LinkListEditor from '#lib/components/directory/LinkListEditor.svelte';
	import VisibilityField from '#lib/components/ui/Form/VisibilityField.svelte';
	import { toast } from 'svelte-sonner';
	import type { DirectoryContact, ProfileLink } from '#lib/server/db/schema/authentication.js';
	import type { getMemberProfile } from '#lib/remote/directory.remote.js';

	// The profile arrives as a plain resolved prop, NOT an awaited remote query.
	// Keeping this component's script fully synchronous matters: a top-level
	// `await` (as the pre-split page had) marks every later declaration as
	// "blocked", compiling each bind:value and fields.X.as(...) expression into
	// an async derived — the reactive churn behind the production
	// effect_update_depth_exceeded crashes (JAVASCRIPT-SVELTEKIT-W).
	let {
		profile,
		instrumentSuggestions,
		genreSuggestions,
		skillSuggestions
	}: {
		profile: Awaited<ReturnType<typeof getMemberProfile>>;
		instrumentSuggestions: string[];
		genreSuggestions: string[];
		skillSuggestions: string[];
	} = $props();

	const { fields } = saveMemberProfile;

	/** The nullable two-value column, as three options. `''` saves as null. */
	const LOOKING_FOR_OPTIONS = [
		{ value: '', label: m.member_profile_profile_form_nothing_right_now_label() },
		{ value: 'band', label: m.member_profile_profile_form_band_join_label() },
		{ value: 'members', label: m.member_profile_profile_form_members_my_project_label() }
	];

	// Editable copies of the complex fields, seeded once from the loaded profile.
	// The untracked snapshot makes the seed-once intent explicit: this form edits
	// a copy, and the parent resolves the queries once so the prop never updates.
	const initial = untrack(() => profile);
	let bioHtml = $state(initial?.bio ?? '');
	let instruments = $state<string[]>(initial?.instruments ?? []);
	let seekingInstruments = $state<string[]>(initial?.seekingInstruments ?? []);
	let genres = $state<string[]>(initial?.genres ?? []);
	let skills = $state<string[]>(initial?.skills ?? []);
	let links = $state<ProfileLink[]>((initial?.links as ProfileLink[] | null) ?? []);
	// The column, not the old boolean — 'members' is the direction a member
	// assembling a band points, and this form had no way to say it.
	let lookingFor = $state<string>(initial?.lookingFor ?? '');
	let availableForHire = $state(initial?.availableForHire ?? false);
	let teachesLessons = $state(initial?.teachesLessons ?? false);
	let openToCollaboration = $state(initial?.openToCollaboration ?? false);
	let directoryVisibility = $state<string>(initial?.directoryVisibility ?? 'members');
	let contactPublic = $state(
		(initial?.directoryContact as DirectoryContact | null)?.visibility === 'public'
	);

	const contact = (initial?.directoryContact as DirectoryContact | null) ?? {};

	// Avatar uploads instantly through the member-avatar API route, which persists
	// the new key and returns it (the value is also submitted with the form).
	// FileUpload previews the picked file locally, so no query refresh is needed —
	// and refreshing getMemberProfile() here would re-resolve the query that seeds
	// the live editors (part of the JAVASCRIPT-SVELTEKIT-W churn).
	async function uploadAvatar(file: File): Promise<string> {
		const fd = new FormData();
		fd.set('file', file);
		const res = await fetch('/api/member/avatar', { method: 'POST', body: fd });
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { message?: string };
			throw new Error(err.message || 'Upload failed');
		}
		const data = (await res.json()) as { avatarKey: string };
		return data.avatarKey;
	}
</script>

<Form
	remote={saveMemberProfile}
	guard
	onsuccess={() => toast.success(m.member_profile_profile_form_toast())}
>
	<!-- Hidden fields for complex data (links renders its own via LinkListEditor) -->
	<input {...fields.instruments.as('hidden', JSON.stringify(instruments))} />
	<input {...fields.seekingInstruments.as('hidden', JSON.stringify(seekingInstruments))} />
	<input {...fields.genres.as('hidden', JSON.stringify(genres))} />
	<input {...fields.skills.as('hidden', JSON.stringify(skills))} />

	<!-- About You: identity, photo, and bio -->
	<InfoCard title={m.member_profile_profile_form_about_title()}>
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
			<div class="flex-1 space-y-4">
				<FormField
					field={fields.tagline}
					label={m.member_profile_profile_form_tagline_label()}
					type="text"
					value={profile?.tagline ?? ''}
					placeholder={m.member_profile_profile_form_e_g_drummer_jazz_funk_placeholder()}
					description={m.member_profile_profile_form_short_one_liner_shown_directory_body()}
				/>
			</div>

			<div class="shrink-0">
				<FileUpload
					upload={uploadAvatar}
					accept="image/jpeg,image/png,image/webp"
					src={profile?.avatarUrl ?? undefined}
					orientation="col"
				>
					{#snippet preview({ src })}
						<EntityAvatar shape="round" name={profile?.name ?? ''} image={src} class="size-24" />
					{/snippet}
				</FileUpload>
			</div>
		</div>

		<div class="mt-4">
			<FormField field={fields.bio} label={m.member_bio_label()}>
				<input {...fields.bio.as('hidden', bioHtml)} />
				<RichTextEditor
					bind:value={bioHtml}
					placeholder={m.member_profile_profile_form_tell_other_members_about_yoursel_placeholder()}
				/>
			</FormField>
		</div>
	</InfoCard>

	<!-- Music -->
	<InfoCard title={m.member_profile_profile_form_music_title()}>
		<div class="grid gap-4 sm:grid-cols-2">
			<FormField field={fields.instruments} label={m.member_instruments_label()}>
				<FreeformTagInput
					bind:value={instruments}
					suggestions={instrumentSuggestions}
					placeholder={m.member_profile_profile_form_e_g_guitar_vocals_drums_placeholder()}
				/>
			</FormField>

			<FormField field={fields.genres} label={m.member_genres_label()}>
				<FreeformTagInput
					bind:value={genres}
					suggestions={genreSuggestions}
					placeholder={m.member_profile_profile_form_e_g_jazz_funk_rock_placeholder()}
				/>
			</FormField>
		</div>

		<div class="mt-4">
			<FormField
				field={fields.skills}
				label={m.member_skills_label()}
				description={m.member_profile_profile_form_what_can_help_with_besides_body()}
			>
				<FreeformTagInput
					bind:value={skills}
					suggestions={skillSuggestions}
					placeholder={m.member_profile_profile_form_e_g_sound_engineer_photographer_placeholder()}
				/>
			</FormField>
		</div>

		<div class="mt-4">
			<FormField
				field={fields.lookingFor}
				type="select"
				label={m.member_profile_profile_form_i_m_looking_label()}
				bind:value={lookingFor}
				options={LOOKING_FOR_OPTIONS}
				description={m.member_profile_profile_form_what_dashboard_matches_we_ll_body()}
			/>
		</div>

		<!-- Only for the direction it belongs to. Asking a member who wants to
		     join a band what instruments they need is a question with no answer. -->
		{#if lookingFor === 'members'}
			<div class="mt-4">
				<FormField
					field={fields.seekingInstruments}
					label={m.member_profile_profile_form_instruments_need_label()}
				>
					<FreeformTagInput
						bind:value={seekingInstruments}
						suggestions={instrumentSuggestions}
						placeholder={m.member_profile_profile_form_e_g_drums_bass_placeholder()}
					/>
				</FormField>
			</div>
		{/if}

		<div class="mt-4 grid gap-3 sm:grid-cols-2">
			<FormField
				field={fields.availableForHire}
				type="toggle"
				value={availableForHire}
				checkboxLabel={m.member_profile_profile_form_i_m_available_hire_checkbox()}
			/>
			<FormField
				field={fields.teachesLessons}
				type="toggle"
				value={teachesLessons}
				checkboxLabel={m.member_profile_profile_form_i_teach_lessons_privately_checkbox()}
			/>
			<FormField
				field={fields.openToCollaboration}
				type="toggle"
				value={openToCollaboration}
				checkboxLabel={m.member_profile_profile_form_i_m_open_collaboration_checkbox()}
			/>
		</div>
	</InfoCard>

	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<!-- Links -->
		<InfoCard title={m.member_profile_profile_form_links_title()}>
			<p class="mb-3 text-muted">
				{m.member_profile_profile_form_add_links_music_social_media_text()}
			</p>
			<LinkListEditor bind:value={links} field={fields.links} />
		</InfoCard>

		<!-- Contact -->
		<InfoCard title={m.member_profile_profile_form_directory_contact_info_title()}>
			<p class="mb-3 text-muted">
				{m.member_profile_profile_form_optional_contact_details_shown_d_text()}
			</p>
			<div class="space-y-3">
				<FormField
					field={fields.contactEmail}
					label={m.member_profile_profile_form_display_email_label()}
					type="email"
					value={contact.email ?? ''}
					placeholder={m.member_profile_profile_form_example_com_placeholder()}
				/>
				<FormField
					field={fields.contactPhone}
					label={m.member_phone_label()}
					type="tel"
					value={contact.phone ?? ''}
					placeholder={m.member_profile_profile_form_optional_placeholder()}
				/>
				<FormField
					field={fields.contactSocial}
					label={m.member_profile_profile_form_social_handle_label()}
					type="text"
					value={contact.social ?? ''}
					placeholder={m.member_profile_profile_form_handle_url_placeholder()}
				/>
				<FormField
					field={fields.contactPublic}
					type="toggle"
					value={contactPublic}
					checkboxLabel={m.member_profile_profile_form_show_my_contact_info_my_checkbox()}
					description={m.member_profile_profile_form_off_by_default_contact_info_body()}
				/>
			</div>
		</InfoCard>
	</div>

	<!-- Visibility -->
	<div class="mb-6">
		<InfoCard title={m.member_profile_profile_form_visibility_title()}>
			<VisibilityField field={fields.directoryVisibility} bind:value={directoryVisibility} />
		</InfoCard>
	</div>

	<div class="flex justify-end">
		<SubmitButton
			label={m.member_save_label()}
			successLabel={m.member_saved_label()}
			variant="primary"
			shortcut="mod+s"
		>
			{#snippet icon()}<IconDeviceFloppy size={18} />{/snippet}
		</SubmitButton>
	</div>
</Form>
