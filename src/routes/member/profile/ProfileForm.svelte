<script lang="ts">
	import { untrack } from 'svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import { saveMemberProfile } from '$lib/remote/directory.remote';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import FileUpload from '$lib/components/shared/Form/FileUpload.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import EntityAvatar from '$lib/components/shared/directory/EntityAvatar.svelte';
	import FreeformTagInput from '$lib/components/shared/FreeformTagInput.svelte';
	import RichTextEditor from '$lib/components/shared/Form/RichTextEditor.svelte';
	import LinkListEditor from '$lib/components/shared/Form/LinkListEditor.svelte';
	import VisibilityField from '$lib/components/shared/Form/VisibilityField.svelte';
	import { toast } from 'svelte-sonner';
	import type { DirectoryContact, ProfileLink } from '$lib/server/db/schema/authentication';
	import type { getMemberProfile } from '$lib/remote/directory.remote';

	// The profile arrives as a plain resolved prop, NOT an awaited remote query.
	// Keeping this component's script fully synchronous matters: a top-level
	// `await` (as the pre-split page had) marks every later declaration as
	// "blocked", compiling each bind:value and fields.X.as(...) expression into
	// an async derived — the reactive churn behind the production
	// effect_update_depth_exceeded crashes (JAVASCRIPT-SVELTEKIT-W).
	let {
		profile,
		instrumentSuggestions,
		genreSuggestions
	}: {
		profile: Awaited<ReturnType<typeof getMemberProfile>>;
		instrumentSuggestions: string[];
		genreSuggestions: string[];
	} = $props();

	const { fields } = saveMemberProfile;

	// Editable copies of the complex fields, seeded once from the loaded profile.
	// The untracked snapshot makes the seed-once intent explicit: this form edits
	// a copy, and the parent resolves the queries once so the prop never updates.
	const initial = untrack(() => profile);
	let bioHtml = $state(initial?.bio ?? '');
	let instruments = $state<string[]>(initial?.instruments ?? []);
	let genres = $state<string[]>(initial?.genres ?? []);
	let links = $state<ProfileLink[]>((initial?.links as ProfileLink[] | null) ?? []);
	let lookingForBand = $state(initial?.lookingForBand ?? false);
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

<Form remote={saveMemberProfile} guard onsuccess={() => toast.success('Profile saved')}>
	<!-- Hidden fields for complex data (links renders its own via LinkListEditor) -->
	<input {...fields.instruments.as('hidden', JSON.stringify(instruments))} />
	<input {...fields.genres.as('hidden', JSON.stringify(genres))} />

	<!-- About You: identity, photo, and bio -->
	<InfoCard title="About You">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
			<div class="flex-1 space-y-4">
				<FormField
					field={fields.tagline}
					label="Tagline"
					type="text"
					value={profile?.tagline ?? ''}
					placeholder="e.g. Drummer | Jazz & Funk"
					description="A short one-liner shown on your directory card"
				/>
			</div>

			<div class="shrink-0">
				<FileUpload
					name="image"
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
			<FormField field={fields.bio} label="Bio">
				<input {...fields.bio.as('hidden', bioHtml)} />
				<RichTextEditor bind:value={bioHtml} placeholder="Tell other members about yourself..." />
			</FormField>
		</div>
	</InfoCard>

	<!-- Music -->
	<InfoCard title="Music">
		<div class="grid gap-4 sm:grid-cols-2">
			<FormField field={fields.instruments} label="Instruments">
				<FreeformTagInput
					bind:value={instruments}
					suggestions={instrumentSuggestions}
					placeholder="e.g. guitar, vocals, drums..."
				/>
			</FormField>

			<FormField field={fields.genres} label="Genres">
				<FreeformTagInput
					bind:value={genres}
					suggestions={genreSuggestions}
					placeholder="e.g. jazz, funk, rock..."
				/>
			</FormField>
		</div>

		<div class="mt-4 grid gap-3 sm:grid-cols-2">
			<FormField
				field={fields.lookingForBand}
				type="toggle"
				value={lookingForBand}
				checkboxLabel="I'm looking for a band"
			/>
			<FormField
				field={fields.availableForHire}
				type="toggle"
				value={availableForHire}
				checkboxLabel="I'm available for hire"
			/>
			<FormField
				field={fields.teachesLessons}
				type="toggle"
				value={teachesLessons}
				checkboxLabel="I teach lessons"
			/>
			<FormField
				field={fields.openToCollaboration}
				type="toggle"
				value={openToCollaboration}
				checkboxLabel="I'm open to collaboration"
			/>
		</div>
	</InfoCard>

	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<!-- Links -->
		<InfoCard title="Links">
			<p class="mb-3 text-muted">
				Add links to your music, social media, or personal site. SoundCloud, YouTube, and Spotify
				links will show as embedded players on your profile.
			</p>
			<LinkListEditor bind:value={links} field={fields.links} />
		</InfoCard>

		<!-- Contact -->
		<InfoCard title="Directory Contact Info">
			<p class="mb-3 text-muted">
				Optional contact details shown on your directory profile. Leave blank to keep private.
			</p>
			<div class="space-y-3">
				<FormField
					field={fields.contactEmail}
					label="Display email"
					type="email"
					value={contact.email ?? ''}
					placeholder="you@example.com"
				/>
				<FormField
					field={fields.contactPhone}
					label="Phone"
					type="tel"
					value={contact.phone ?? ''}
					placeholder="Optional"
				/>
				<FormField
					field={fields.contactSocial}
					label="Social handle"
					type="text"
					value={contact.social ?? ''}
					placeholder="@handle or URL"
				/>
				<FormField
					field={fields.contactPublic}
					type="toggle"
					value={contactPublic}
					checkboxLabel="Show my contact info on my public profile"
					description="Off by default, your contact info is only visible to logged-in members."
				/>
			</div>
		</InfoCard>
	</div>

	<!-- Visibility -->
	<div class="mb-6">
		<InfoCard title="Visibility">
			<VisibilityField field={fields.directoryVisibility} bind:value={directoryVisibility} />
		</InfoCard>
	</div>

	<div class="flex justify-end">
		<SubmitButton label="Save" successLabel="Saved" variant="primary" shortcut="mod+s">
			{#snippet icon()}<IconDeviceFloppy size={18} />{/snippet}
		</SubmitButton>
	</div>
</Form>
