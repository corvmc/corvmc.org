<script lang="ts">
	import { untrack } from 'svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import { baseDomainFromSiteUrl } from '$lib/utils/band-site-url';
	import { env } from '$env/dynamic/public';
	import { resolve } from '$app/paths';
	import RichTextEditor from '$lib/components/shared/Form/RichTextEditor.svelte';
	import LinkListEditor from '$lib/components/shared/Form/LinkListEditor.svelte';
	import VisibilityField from '$lib/components/shared/Form/VisibilityField.svelte';
	import FreeformTagInput from '$lib/components/shared/FreeformTagInput.svelte';
	import { saveBandProfile } from '$lib/remote/directory.remote';
	import type { getBandProfile } from '$lib/remote/directory.remote';
	import type { getBandLayout } from '$lib/remote/layout.remote';
	import type { DirectoryContact, ProfileLink } from '$lib/server/db/schema/authentication';

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
		isOwner = false
	}: {
		band: Awaited<ReturnType<typeof getBandLayout>>['band'];
		profile: Awaited<ReturnType<typeof getBandProfile>>;
		genreSuggestions: string[];
		/** Only the owner can move the address; everyone else just sees it. */
		isOwner?: boolean;
	} = $props();

	const profileFields = saveBandProfile.fields;
	const baseDomain = $derived(baseDomainFromSiteUrl(env.PUBLIC_SITE_URL));

	// Editable copies of the complex fields, seeded once from the loaded profile.
	const initial = untrack(() => profile);
	let bioHtml = $state(untrack(() => band.bio) ?? '');
	let genres = $state<string[]>(initial?.genres ?? []);
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
		toast.success('Profile saved');
		// No slug branch: renaming the band no longer moves its address, so the
		// page always stays where it is. Band settings is where an owner changes it.
		invalidateAll();
	}}
	onfailure={() => toast.error('Failed to save')}
>
	<input {...profileFields.genres.as('hidden', JSON.stringify(genres))} />

	<!-- Basics -->
	<InfoCard title="Basics">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
			<div class="flex-1 space-y-4">
				<FormField
					field={profileFields.name}
					type="text"
					label="Band Name"
					value={band.name}
					required
				/>

				<!-- This is the page people come to when they want to change the
				     band's identity, and it is the one page that deliberately does
				     not move the address. Saying so here — with the address in
				     front of them — beats letting them rename and then wonder why
				     the URL didn't follow. -->
				<FormField label="Band address" readonly display={`${band.slug}.${baseDomain}`}>
					{#snippet description()}
						Renaming the band doesn't move its address.{#if isOwner}
							<a href={resolve(`/band/${band.slug}/settings`)} class="link link-primary ml-1">
								Change it in Settings
							</a>
						{/if}
					{/snippet}
				</FormField>

				<FormField
					field={profileFields.tagline}
					label="Tagline"
					type="text"
					value={profile?.tagline ?? ''}
					placeholder="e.g. Funk trio from Portland"
					description="A short one-liner shown on your directory card"
				/>
			</div>

			<FormField
				label="Avatar"
				name="avatarKey"
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
					label="Hometown"
					type="text"
					value={profile?.hometown ?? ''}
					placeholder="e.g. Corvallis, OR"
					description="Shown as “Based in” on your profile"
				/>

				<FormField
					field={profileFields.foundedYear}
					label="Founded"
					type="text"
					value={profile?.foundedYear ?? ''}
					placeholder="e.g. 2019"
					description="Shown as “Formed” on your profile"
				/>
			</div>

			<FormField field={profileFields.bio} label="Bio">
				<input {...profileFields.bio.as('hidden', bioHtml)} />
				<RichTextEditor bind:value={bioHtml} placeholder="Tell people about your band..." />
			</FormField>

			<FormField field={profileFields.genres} label="Genres">
				<FreeformTagInput
					bind:value={genres}
					suggestions={genreSuggestions}
					placeholder="e.g. jazz, funk, rock..."
				/>
			</FormField>

			<FormField
				field={profileFields.lookingForMembers}
				type="toggle"
				value={lookingForMembers}
				checkboxLabel="We're looking for members"
			/>
		</div>
	</InfoCard>

	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<InfoCard title="Links">
			<p class="mb-3 text-muted">
				SoundCloud, YouTube, and Spotify links show as embedded players on your profile.
			</p>
			<LinkListEditor bind:value={links} field={profileFields.links} />
		</InfoCard>

		<InfoCard title="Directory Contact Info">
			<p class="mb-3 text-muted">Optional contact details shown on your directory listing.</p>
			<div class="space-y-3">
				<FormField
					field={profileFields.contactEmail}
					label="Display email"
					type="email"
					value={contact.email ?? ''}
					placeholder="band@example.com"
				/>
				<FormField
					field={profileFields.contactPhone}
					label="Phone"
					type="tel"
					value={contact.phone ?? ''}
				/>
				<FormField
					field={profileFields.contactSocial}
					label="Social handle"
					type="text"
					value={contact.social ?? ''}
					placeholder="@handle or URL"
				/>
			</div>
		</InfoCard>
	</div>

	<div class="mb-6">
		<InfoCard title="Visibility">
			<VisibilityField
				field={profileFields.directoryVisibility}
				bind:value={directoryVisibility}
				publicDescription="Anyone can see this band's profile, no login required"
			/>
		</InfoCard>
	</div>

	<div class="flex justify-end">
		<SubmitButton label="Save" successLabel="Saved" variant="primary" shortcut="mod+s">
			{#snippet icon()}<IconDeviceFloppy size={18} />{/snippet}
		</SubmitButton>
	</div>
</Form>
