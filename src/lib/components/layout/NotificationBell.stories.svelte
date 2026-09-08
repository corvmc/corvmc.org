<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import NotificationBell from './NotificationBell.svelte';
	import type { ChromeNotification } from './chrome';

	const { Story } = defineMeta({
		title: 'Layout/NotificationBell',
		component: NotificationBell,
		tags: ['autodocs'],
		parameters: { layout: 'centered' },
		args: { notifications: [], unreadCount: 0 }
	});

	const MINUTE = 60_000;

	// The panel is anchored to the bell and only exists while `open`, so each
	// story shows the closed trigger until you click it — which is also the only
	// state the badge is visible in.
	function at(minutesAgo: number, overrides: Partial<ChromeNotification> = {}) {
		return {
			id: `n-${minutesAgo}-${overrides.title ?? ''}`,
			userId: 'user-1',
			type: 'reservation',
			title: 'Reservation confirmed',
			body: null,
			href: null,
			data: null,
			readAt: null,
			createdAt: new Date(Date.now() - minutesAgo * MINUTE),
			...overrides
		} as ChromeNotification;
	}

	const MIXED = [
		at(0, { title: 'Reservation confirmed', body: 'Fri, Mar 14 · 7:00–9:00 PM', href: '/member' }),
		at(45, { title: 'Loud Night needs a door volunteer', href: '/member/volunteer' }),
		at(3 * 60, { title: 'Your Fender Twin loan is due back', readAt: new Date() }),
		at(4 * 24 * 60, { title: 'March newsletter went out', readAt: new Date() })
	];
</script>

<!-- Empty is a real state, not a placeholder: the panel has to say so rather
     than open onto a blank strip. -->
<Story name="No notifications" />

<Story name="Unread" args={{ notifications: MIXED, unreadCount: 2 }} />

<!-- Read and unread rows differ by a dot and a tinted row; a read row with no
     href renders no button at all, so there is nothing to click by mistake. -->
<Story
	name="All read"
	args={{ notifications: MIXED.map((n) => ({ ...n, readAt: new Date() })), unreadCount: 0 }}
/>

<!-- The badge is a fixed-size pill, so the count is clamped rather than allowed
     to widen it — three digits would push it off the button. -->
<Story name="Badge overflow" args={{ notifications: MIXED, unreadCount: 128 }} />
