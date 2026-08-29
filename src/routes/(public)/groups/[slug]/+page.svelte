<script lang="ts">
	import { page } from '$app/state';
	import Hero from '$lib/components/public/Hero.svelte';
	import Section from '$lib/components/public/Section.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { resolve } from '$app/paths';
	import JoinGroupAction from '$lib/components/groups/JoinGroupAction.svelte';
	import { getPublicGroupPage } from '$lib/remote/groups.remote';

	/**
	 * A program's public page — name, what it is, and the way in.
	 *
	 * The Join button is the only write on a public page in this app. It needs a
	 * session, so a signed-out visitor gets a sign-in prompt that returns them
	 * here rather than a button that fails.
	 *
	 * Whether to offer it at all is decided on the server: `viewerStatus` carries
	 * the two *waiting* states as well as membership, because somebody whose
	 * application is still pending is not a member and must not be offered Apply
	 * a second time.
	 */
	const data = $derived(await getPublicGroupPage(page.params.slug!));
	const group = $derived(data.group);
	const status = $derived(data.viewerStatus?.status ?? null);

	const kindLabel = $derived(group.kind === 'committee' ? 'Committee' : 'Club');
	const joinable = $derived(group.joinPolicy === 'open' || group.joinPolicy === 'by_application');
</script>

<svelte:head>
	<title>{group.name} | Corvallis Music Collective</title>
	{#if group.bio}
		<meta name="description" content={group.bio} />
	{/if}
</svelte:head>

<Hero title={group.name}>{kindLabel} at the Corvallis Music Collective</Hero>

<Section>
	<div class="mx-auto flex max-w-2xl flex-col gap-6">
		{#if group.bio}
			<p class="text-base leading-relaxed text-fg-2">{group.bio}</p>
		{/if}

		<p class="text-subtle">
			<Badge variant="ghost">{kindLabel}</Badge>
			{group.memberCount}
			{group.memberCount === 1 ? 'member' : 'members'}
		</p>

		{#if group.joinInstructions}
			<!-- The group's own words about how it works. Under `open` this is the
			     practical note beside the button; under `by_application` it is the
			     prompt over the box, which is where it earns the most. -->
			<p class="text-base">{group.joinInstructions}</p>
		{/if}

		{#if status === 'active'}
			<Alert type="success">
				You're already in this group.
				<Button href={resolve(`/member/groups/${group.slug}`)} variant="ghost" size="sm">
					Open it
				</Button>
			</Alert>
		{:else if status === 'requested'}
			<Alert type="info">Your application is with this group's leaders.</Alert>
		{:else if status === 'pending'}
			<Alert type="info">You've been invited to this group — accept it from your groups page.</Alert
			>
		{:else if !joinable}
			<Alert type="info">
				This group is invite only. Ask someone in it, or get in touch with the Collective.
			</Alert>
		{:else if !data.signedIn}
			<!-- A prompt rather than a button that fails. The redirect brings them
			     back here, where the button will work. -->
			<Alert type="info">
				<span>Sign in to {group.joinPolicy === 'open' ? 'join' : 'apply'}.</span>
				<Button href={`/login?redirect=/groups/${group.slug}`} variant="primary" size="sm">
					Sign in
				</Button>
			</Alert>
		{:else}
			<div>
				<JoinGroupAction
					groupId={group.id}
					groupName={group.name}
					policy={group.joinPolicy === 'open' ? 'open' : 'by_application'}
					instructions={group.joinInstructions}
				/>
			</div>
		{/if}
	</div>
</Section>
