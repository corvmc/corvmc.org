<script module lang="ts">
	/**
	 * Renders a colored icon with a tooltip label based on the status string,
	 * or a labelled badge when `label` is set.
	 *
	 * `variants` and `badgeClass` are exported so `StatusBadge.spec.ts` can assert
	 * that every status enum in the app is covered. Add the entry here whenever a
	 * new status value is introduced — an unmapped status renders the neutral
	 * fallback dot, which says nothing.
	 */
	import {
		IconClock,
		IconCircleCheck,
		IconCircleCheckFilled,
		IconUserX,
		IconUserQuestion,
		IconCircleX,
		IconCircleOff,
		IconPencil,
		IconWorld,
		IconAlertTriangle,
		IconArrowBackUp,
		IconClockPause,
		IconInboxOff,
		IconAlarmSnooze,
		IconCrown,
		IconShield,
		IconUser,
		IconTool,
		IconArchive,
		IconPackageExport,
		IconPackageImport,
		IconTicket,
		IconSend,
		IconMailCheck,
		IconBan,
		IconStar,
		IconPointFilled,
		IconCalendarEvent,
		IconArrowMerge,
		IconEyeOff
	} from '@tabler/icons-svelte';
	import {
		volunteerHourStatusLabels,
		volunteerProfileStatusLabels,
		suggestionStatusLabels
	} from '$lib/config';
	import type { SvelteComponent } from 'svelte';

	type IconComponent = typeof SvelteComponent<any>;

	export type StatusVariant = { icon: IconComponent; color: string };

	/**
	 * Statuses whose display text is not just the humanised enum value. Exported
	 * so `StatusBadge.spec.ts` can assert no key here has outlived its vocabulary.
	 */
	export const labels: Record<string, string> = {
		...volunteerHourStatusLabels,
		...volunteerProfileStatusLabels,
		// `in_progress` is the only suggestion status the humaniser gets wrong.
		...suggestionStatusLabels,
		// "Pending review" reads as a state; the humanised enum ("Pending_review")
		// does not.
		pending_review: 'In review'
	};

	export const badgeClass: Record<string, string> = {
		// Reservations
		scheduled: 'badge-warning',
		confirmed: 'badge-info',
		completed: 'badge-success',
		no_show: 'badge-error',
		cancelled: 'badge-ghost',
		waitlisted: 'badge-ghost',
		refunded: 'badge-error',
		// Events
		draft: 'badge-warning',
		pending_review: 'badge-info',
		published: 'badge-success',
		// Inbox. `awaiting_reply` is ghost against open's info on purpose: the
		// thread is still open work, but nothing is owed from this end today.
		open: 'badge-info',
		awaiting_reply: 'badge-ghost',
		resolved: 'badge-success',
		dismissed: 'badge-ghost',
		snoozed: 'badge-ghost',
		// Band roles
		owner: 'badge-warning',
		admin: 'badge-info',
		member: 'badge-ghost',
		// Equipment
		available: 'badge-success',
		maintenance: 'badge-warning',
		retired: 'badge-ghost',
		// Equipment loans
		requested: 'badge-warning',
		checked_out: 'badge-info',
		returned: 'badge-success',
		// Tickets
		valid: 'badge-info',
		checked_in: 'badge-success',
		// Band tiers
		free: 'badge-ghost',
		premium: 'badge-warning',
		// Campaigns
		sending: 'badge-info',
		sent: 'badge-success',
		// Platform invites
		accepted: 'badge-success',
		revoked: 'badge-error',
		// Certifications a member holds. Expiring is a warning rather than an
		// error: the clearance is still valid, it just needs booking in.
		current: 'badge-success',
		expiring: 'badge-warning',
		expired: 'badge-error',
		// Volunteer hour logs
		approved: 'badge-success',
		rejected: 'badge-error',
		// Volunteer profiles. Warning, not error: an under-18 signup is somebody
		// answering honestly, and staff owe them a conversation rather than a refusal.
		blocked: 'badge-warning',
		// Whether someone holds what a role requires. Warning, not error, for the
		// same reason: an uncleared volunteer needs training booked, not refusing.
		cleared: 'badge-success',
		uncleared: 'badge-warning',
		// Suggestions. `open` and `pending_review` are shared with the inbox and
		// event vocabularies above and already carry the right weight.
		planned: 'badge-info',
		in_progress: 'badge-warning',
		done: 'badge-success',
		declined: 'badge-ghost',
		// Derived, not stored — see displayStatus() in suggestion-service.
		merged: 'badge-ghost',
		// Warning, not error: a reported suggestion is waiting on staff, and most
		// reports get dismissed.
		under_review: 'badge-warning',
		hidden: 'badge-ghost',
		// Generic
		active: 'badge-success',
		deactivated: 'badge-ghost',
		pending: 'badge-warning',
		error: 'badge-error'
	};

	export const variants: Record<string, StatusVariant> = {
		// Reservation statuses
		scheduled: { icon: IconClock, color: 'text-warning' },
		confirmed: { icon: IconCircleCheck, color: 'text-info' },
		completed: { icon: IconCircleCheckFilled, color: 'text-success' },
		no_show: { icon: IconUserX, color: 'text-error' },
		cancelled: { icon: IconCircleX, color: 'text-base-content' },
		waitlisted: { icon: IconClockPause, color: 'text-base-content' },
		refunded: { icon: IconArrowBackUp, color: 'text-error' },

		// Event statuses
		draft: { icon: IconPencil, color: 'text-warning' },
		// Waiting on staff, not on its author — the hourglass is the whole point.
		pending_review: { icon: IconClockPause, color: 'text-info' },
		published: { icon: IconWorld, color: 'text-success' },
		// `rejected` is shared with volunteer hour logs below — same meaning
		// (sent back to its author to fix), same glyph, labelled "Returned".

		// Inbox statuses. `awaiting_reply` is derived, not stored — see
		// threadDisplayStatus() in components/inbox/thread-status.ts.
		open: { icon: IconClock, color: 'text-info' },
		awaiting_reply: { icon: IconSend, color: 'text-base-content' },
		resolved: { icon: IconInboxOff, color: 'text-success' },
		dismissed: { icon: IconCircleX, color: 'text-base-content' },
		snoozed: { icon: IconAlarmSnooze, color: 'text-base-content' },

		// Band roles
		owner: { icon: IconCrown, color: 'text-warning' },
		admin: { icon: IconShield, color: 'text-info' },
		member: { icon: IconUser, color: 'text-base-content' },

		// Equipment statuses
		available: { icon: IconCircleCheck, color: 'text-success' },
		maintenance: { icon: IconTool, color: 'text-warning' },
		retired: { icon: IconArchive, color: 'text-base-content' },

		// Equipment loan statuses
		requested: { icon: IconClock, color: 'text-warning' },
		checked_out: { icon: IconPackageExport, color: 'text-info' },
		returned: { icon: IconPackageImport, color: 'text-success' },

		// Ticket statuses
		valid: { icon: IconTicket, color: 'text-info' },
		checked_in: { icon: IconCircleCheckFilled, color: 'text-success' },

		// Band tiers
		free: { icon: IconPointFilled, color: 'text-base-content/60' },
		premium: { icon: IconStar, color: 'text-warning' },

		// Campaign statuses
		sending: { icon: IconSend, color: 'text-info' },
		sent: { icon: IconMailCheck, color: 'text-success' },

		// Platform invite statuses
		accepted: { icon: IconCircleCheck, color: 'text-success' },
		revoked: { icon: IconBan, color: 'text-error' },

		// Suggestion statuses. `open` (inbox) and `pending_review` (events) are
		// already mapped above and mean the same thing here.
		planned: { icon: IconCalendarEvent, color: 'text-info' },
		in_progress: { icon: IconTool, color: 'text-warning' },
		done: { icon: IconCircleCheckFilled, color: 'text-success' },
		declined: { icon: IconCircleX, color: 'text-base-content' },

		// Suggestion visibility. `visible` is deliberately unmapped — a suggestion
		// on the board needs no glyph, and its absence is the signal.
		merged: { icon: IconArrowMerge, color: 'text-base-content' },
		under_review: { icon: IconAlertTriangle, color: 'text-warning' },
		hidden: { icon: IconEyeOff, color: 'text-base-content' },

		// Certification a member holds. `revoked` is shared with platform invites
		// above; only the three lapse states are new here.
		current: { icon: IconCircleCheck, color: 'text-success' },
		expiring: { icon: IconAlertTriangle, color: 'text-warning' },
		expired: { icon: IconCircleX, color: 'text-error' },

		// Volunteer hour log statuses
		approved: { icon: IconCircleCheckFilled, color: 'text-success' },
		rejected: { icon: IconCircleX, color: 'text-error' },

		// Volunteer profile statuses
		blocked: { icon: IconUserQuestion, color: 'text-warning' },

		// Volunteer clearance readiness
		cleared: { icon: IconCircleCheck, color: 'text-success' },
		uncleared: { icon: IconAlertTriangle, color: 'text-warning' },

		// Generic
		active: { icon: IconCircleCheck, color: 'text-success' },
		deactivated: { icon: IconCircleOff, color: 'text-base-content' },
		pending: { icon: IconClock, color: 'text-warning' },
		error: { icon: IconAlertTriangle, color: 'text-error' }
	};

	/**
	 * Neutral, not an X. An unmapped status is a gap in `variants`, not an error
	 * state — rendering a red X made available equipment read as broken.
	 */
	const fallback: StatusVariant = { icon: IconPointFilled, color: 'text-base-content/40' };

	/**
	 * What a status is called on screen: an override from `labels` where the
	 * humanised enum reads wrong, otherwise the enum with its underscores
	 * removed.
	 *
	 * Exported because anything else drawing a status glyph needs the same
	 * string for its accessible name, and two copies of this would drift.
	 */
	export function statusLabel(status: string): string {
		if (labels[status]) return labels[status];
		const s = status.replace(/_/g, ' ');
		return s.charAt(0).toUpperCase() + s.slice(1);
	}
</script>

<script lang="ts">
	let {
		status,
		size = 20,
		label: showLabel = false,
		class: className = ''
	}: {
		status: string;
		size?: number;
		label?: boolean;
		class?: string;
	} = $props();

	const variant = $derived(variants[status] ?? fallback);
	const label = $derived(statusLabel(status));
</script>

{#if showLabel}
	<span class="badge badge-sm gap-1 {badgeClass[status] ?? 'badge-ghost'} {className}">
		<variant.icon size={14} />
		{label}
	</span>
{:else}
	<!--
		`role="img"` + `aria-label` because `data-tip` is daisyUI's CSS-only
		tooltip: it draws through ::before, so assistive tech never sees it. Without
		this the icon-only form has no accessible name at all — every staff table's
		status column announced its header and then nothing for each value, and the
		entity cards carry status as a glyph alone.
	-->
	<span class="tooltip tooltip-right" data-tip={label} role="img" aria-label={label}>
		<variant.icon {size} class="{variant.color} {className}" />
	</span>
{/if}
