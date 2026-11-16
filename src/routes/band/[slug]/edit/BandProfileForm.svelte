<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import { refreshAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { baseDomainFromSiteUrl } from '#lib/utils/band-site-url.js';
	import * as env from '$app/env/public';
	import { resolve } from '$app/paths';
	import RichTextEditor from '#lib/components/ui/Form/RichTextEditor.svelte';
	import LinkListEditor from '#lib/components/directory/LinkListEditor.svelte';
	import VisibilityField from '#lib/components/ui/Form/VisibilityField.svelte';
	import FreeformTagInput from '#lib/components/ui/FreeformTagInput.svelte';
	import { saveBandProfile } from '#lib/remote/directory.remote.js';
	import type { getBandProfile } from '#lib/remote/directory.remote.js';
	import type { getBandLayout } from '#lib/remote/layout.remote.js';
	import type { DirectoryContact, ProfileLink } from '#lib/server/db/schema/authentication.js';

	// The band and profile arrive as plain resolved props, NOT awaited remote
	// queries. Keeping this component's script fully synchronous matters: a
	// top-level `await` (as the pre-split page had) marks every later declaration
	// as "blocked", compiling each bind:value and fields.X.as() expression into
	// an async derived — the reactive churn behind the effect_update_depth_exceeded
	// crash on this page (same bug as /member/profile, JAVASCRIPT-SVELTEKIT-W).
	let {
		band,
		profile,
		genreSuggestions,
		instrumentSuggestions,
		isOwner = false
	}: {
		band: Awaited<ReturnType<typeof getBandLayout>>['band'];
		profile: Awaited<ReturnType<typeof getBandProfile>>;
		genreSuggestions: string[];
		/** The same vocabulary members tag themselves with — see `getBandProfileEditor`. */
		instrumentSuggestions: string[];
		/** Only the owner can move the address; everyone else just sees it. */
		isOwner?: boolean;
	} = $props();

	const profileFields = saveBandProfile.fields;
	const baseDomain = $derived(baseDomainFromSiteUrl(env.PUBLIC_SITE_URL));

	// Editable copies of the complex fields, seeded once from the loaded profile.
	const initial = untrack(() => profile);
	let bioHtml = $state(untrack(() => band.bio) ?? '');
	let genres = $state<string[]>(initial?.genres ?? []);
	let seekingInstruments = $state<string[]>(initial?.seekingInstruments ?? []);
	let links = $state<ProfileLink[]>((initial?.links as ProfileLink[] | null) ?? []);
	let lookingForMembers = $state(initial?.lookingForMembers ?? false);
	let directoryVisibility = $state<string>(initial?.directoryVisibility ?? 'public');

	const contact = (initial?.directoryContact as DirectoryContact | null) ?? {};

	// Avatar uploads instantly through the band-avatar API route, which persists
	// the new key and returns it (the value is also submitted with the form).
	// The field previews the picked file locally, so no query refresh is needed.
	async function uploadAvatar(file: File): Promise<string> {
		const fd = new FormData();
		fd.set('file', file);
		const res = await fetch(`/api/bands/${band.id}/avatar`, { method: 'POST', body: fd });
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { message?: string };
			throw new Error(err.message || 'Upload failed');
		}
		const data = (await res.json()) as { avatarKey: string };
		return data.avatarKey;
	}
</script>

<Form
	remote={saveBandProfile}
	guard
	onsuccess={() => {
		toast.success(m.band_slug_edit_band_profile_form_toast());
		// No slug branch: renaming the band no longer moves its address, so the
		// page always stays where it is. Band settings is where an owner changes it.
		refreshAll();
	}}
>
	<input {...profileFields.slug.as('hidden', band.slug)} />
	<input {...profileFields.genres.as('hidden', JSON.stringify(genres))} />
	<input {...profileFields.seekingInstruments.as('hidden', JSON.stringify(seekingInstruments))} />

	<!-- Basics -->
	<InfoCard title={m.band_slug_edit_band_profile_form_basics_title()}>
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
			<div class="flex-1 space-y-4">
				<FormField
					field={profileFields.name}
					type="text"
					label={m.band_slug_edit_band_profile_form_band_name_label()}
					value={band.name}
					required
				/>

				<!-- This is the page people come to when they want to change the
				     band's identity, and it is the one page that deliberately does
				     not move the address. Saying so here — with the address in
				     front of them — beats letting them rename and then wonder why
				     the URL didn't follow. -->
				<FormField
					label={m.band_slug_edit_band_profile_form_band_address_label()}
					readonly
					display={`${band.slug}.${baseDomain}`}
				>
					{#snippet description()}
						{m.band_slug_edit_band_profile_form_renaming_band_doesn_t_move_body()}{#if isOwner}
							<a href={resolve(`band/${band.slug}/settings`)} class="ml-1 link link-primary">
								{m.band_slug_edit_band_profile_form_change_settings_text()}
							</a>
						{/if}
					{/snippet}
				</FormField>

				<FormField
					field={profileFields.tagline}
					label={m.band_slug_edit_band_profile_form_tagline_label()}
					type="text"
					value={profile?.tagline ?? ''}
					placeholder={m.band_slug_edit_band_profile_form_e_g_funk_trio_from_placeholder()}
					description={m.band_slug_edit_band_profile_form_short_one_liner_shown_direc_body()}
				/>
			</div>

			<FormField
				label={m.band_slug_edit_band_profile_form_avatar_label()}
				type="file"
				upload={uploadAvatar}
				accept="image/jpeg,image/png,image/webp"
				src={band.avatarUrl ?? undefined}
				orientation="col"
				class="shrink-0"
			/>
		</div>

		<div class="mt-4 space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<FormField
					field={profileFields.hometown}
					label={m.band_slug_edit_band_profile_form_hometown_label()}
					type="text"
					value={profile?.hometown ?? ''}
					placeholder={m.band_slug_edit_band_profile_form_e_g_corvallis_placeholder()}
					description={m.band_slug_edit_band_profile_form_shown_as_based_profile_body()}
				/>

				<FormField
					field={profileFields.foundedYear}
					label={m.band_slug_edit_band_profile_form_founded_label()}
					type="text"
					value={profile?.foundedYear ?? ''}
					placeholder={m.band_slug_edit_band_profile_form_e_g_2019_placeholder()}
					description={m.band_slug_edit_band_profile_form_shown_as_formed_profile_body()}
				/>
			</div>

			<FormField field={profileFields.bio} label={m.band_slug_edit_band_profile_form_bio_label()}>
				<input {...profileFields.bio.as('hidden', bioHtml)} />
				<RichTextEditor
					bind:value={bioHtml}
					placeholder={m.band_slug_edit_band_profile_form_tell_people_about_act_placeholder()}
				/>
			</FormField>

			<FormField
				field={profileFields.genres}
				label={m.band_slug_edit_band_profile_form_genres_label()}
			>
				<FreeformTagInput
					bind:value={genres}
					suggestions={genreSuggestions}
					placeholder={m.band_slug_edit_band_profile_form_e_g_jazz_funk_rock_placeholder()}
				/>
			</FormField>

			<FormField
				field={profileFields.lookingForMembers}
				type="toggle"
				bind:value={lookingForMembers}
				checkboxLabel={m.band_slug_edit_band_profile_form_checkbox_label_checkbox()}
			/>

			<!-- The half a band could never say before: "we want members" had
			     nothing attached to it, so a match had only genre to aim at. Shown
			     with the toggle it belongs to, and it is what puts this band on the
			     dashboard of a member who plays what you are short of. -->
			{#if lookingForMembers}
				<FormField
					field={profileFields.seekingInstruments}
					label={m.band_slug_edit_band_profile_form_what_we_re_looking_label()}
				>
					<FreeformTagInput
						bind:value={seekingInstruments}
						suggestions={instrumentSuggestions}
						placeholder={m.band_slug_edit_band_profile_form_e_g_drums_bass_vocals_placeholder()}
					/>
				</FormField>
			{/if}
		</div>
	</InfoCard>

	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<InfoCard title={m.band_slug_edit_band_profile_form_links_title()}>
			<p class="mb-3 text-muted">
				{m.band_slug_edit_band_profile_form_soundcloud_youtube_spotify_text()}
			</p>
			<LinkListEditor bind:value={links} field={profileFields.links} />
		</InfoCard>

		<!-- These used to be printed on the public page as the act's booking
		     details. They are not any more: a stranger reaches the act through a
		     form, so nothing is published for a scraper to take. The fields stay
		     because they still route an enquiry — but the page has to say that,
		     or a band reads "contact info" and assumes it is on display. -->
		<InfoCard title={m.band_slug_edit_band_profile_form_where_enquiries_go_title()}>
			<p class="mb-3 text-muted">
				{m.band_slug_edit_band_profile_form_never_shown_publicly_page_o_text()}
			</p>
			<div class="space-y-3">
				<FormField
					field={profileFields.contactEmail}
					label={m.band_email_label()}
					type="email"
					value={contact.email ?? ''}
					placeholder={m.band_slug_edit_band_profile_form_band_example_com_placeholder()}
				/>
				<FormField
					field={profileFields.contactPhone}
					label={m.band_phone_label()}
					type="tel"
					value={contact.phone ?? ''}
				/>
				<FormField
					field={profileFields.contactSocial}
					label={m.band_slug_edit_band_profile_form_social_handle_label()}
					type="text"
					value={contact.social ?? ''}
					placeholder={m.band_slug_edit_band_profile_form_handle_url_placeholder()}
				/>
			</div>
		</InfoCard>
	</div>

	<div class="mb-6">
		<InfoCard title={m.band_slug_edit_band_profile_form_visibility_title()}>
			<VisibilityField
				field={profileFields.directoryVisibility}
				bind:value={directoryVisibility}
				publicDescription={m.band_slug_edit_band_profile_form_public_description_body()}
			/>
		</InfoCard>
	</div>

	<div class="flex justify-end">
		<SubmitButton
			label={m.band_save_label()}
			successLabel={m.band_saved_label()}
			variant="primary"
			shortcut="mod+s"
		>
			{#snippet icon()}<IconDeviceFloppy size={18} />{/snippet}
		</SubmitButton>
	</div>
</Form>
