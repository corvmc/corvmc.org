<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import {
		IconActivity,
		IconBuildingWarehouse,
		IconCoin,
		IconMail,
		IconShieldHalf,
		IconUserCircle,
		IconUsers
	} from '@tabler/icons-svelte';
	import TabBar from './TabBar.svelte';

	const { Story } = defineMeta({
		title: 'Shared/TabBar',
		component: TabBar,
		tags: ['autodocs'],
		parameters: { layout: 'padded' },
		args: { active: 'overview' }
	});

	// The eight-tab staff user record — the set that motivated both `collapse`
	// and `dense`, because a `join` does not wrap and <main> clips what overflows.
	const STAFF_RECORD = [
		{ key: 'overview', label: 'Overview', icon: IconActivity, badge: 2 },
		{ key: 'space', label: 'Space', icon: IconBuildingWarehouse },
		{ key: 'bands', label: 'Bands', icon: IconUsers },
		{ key: 'volunteer', label: 'Volunteer', icon: IconUserCircle },
		{ key: 'money', label: 'Money', icon: IconCoin },
		{ key: 'comms', label: 'Comms', icon: IconMail },
		{ key: 'moderation', label: 'Moderation', icon: IconShieldHalf }
	];

	const SHORT = [
		{ key: 'overview', label: 'Overview' },
		{ key: 'space', label: 'Space' },
		{ key: 'bands', label: 'Bands' }
	];

	// Link tabs render real anchors instead of a tablist, so middle-click and
	// copy-link work. `as never` because `href` is typed `ResolvedPathname`,
	// which only `resolve()` can produce — a story has no router to ask.
	const LINKS = [
		{ key: 'pending', label: 'Pending', href: '/staff/inbox?view=pending', badge: 4 },
		{ key: 'mine', label: 'Assigned to me', href: '/staff/inbox?view=mine' },
		{ key: 'closed', label: 'Closed', href: '/staff/inbox?view=closed' }
	] as never;
</script>

<Story name="Default" args={{ tabs: SHORT }} />

<!-- The two overflow answers, side by side. `collapse` is for a narrow screen
     and only shows its menu below `md`, so resize the canvas to see it; `dense`
     is for a narrow pane at any viewport width, and shows here as-is. -->
<Story name="Collapsing" args={{ tabs: STAFF_RECORD, collapse: true }} />
<Story name="Dense" args={{ tabs: STAFF_RECORD, dense: true, active: 'money' }} />

<!-- A partly-iconed set degrades to words rather than to blanks, which is the
     reason `dense` keys off `icon` per tab instead of off the mode. -->
<Story
	name="Dense, missing icons"
	args={{
		tabs: STAFF_RECORD.map((t, i) => (i % 2 ? { ...t, icon: undefined } : t)),
		dense: true
	}}
/>

<Story name="Links" args={{ tabs: LINKS, active: 'pending' }} />

<!-- A badge may be a snippet as well as a number, so a count that needs its own
     remote query can be a component instead of something the page resolves
     first — resolving it on the page would put a second query in flight there. -->
{#snippet liveCount()}
	<span class="ml-1 badge badge-sm badge-warning">3 new</span>
{/snippet}

<Story
	name="Snippet badge"
	args={{
		tabs: [
			{ key: 'overview', label: 'Overview' },
			{ key: 'comms', label: 'Comms', badge: liveCount }
		]
	}}
/>
