import {
	IconMail,
	IconMessageCircle,
	IconWorld,
	IconMessages,
	IconBrandInstagram,
	IconBrandFacebook,
	IconUsers,
	IconMicrophone2
} from '@tabler/icons-svelte';
import { inboxChannels, META_HUMAN_AGENT_WINDOW_MS } from '$lib/config';

type Channel = (typeof inboxChannels)[number];

/**
 * How each inbox channel is named and drawn. Single source of truth: the list
 * and detail pages previously kept their own copies and disagreed about `web`
 * ("Web" in one, "Contact Form" in the other).
 */
export const channelLabels: Record<Channel, string> = {
	email: 'Email',
	sms: 'SMS',
	web: 'Contact Form',
	portal: 'Member Portal',
	direct: 'Direct Message',
	band: 'Booking Enquiry',
	instagram: 'Instagram',
	messenger: 'Messenger'
};

export const channelIcons: Record<Channel, typeof IconMail> = {
	email: IconMail,
	sms: IconMessageCircle,
	web: IconWorld,
	portal: IconMessages,
	direct: IconUsers,
	band: IconMicrophone2,
	instagram: IconBrandInstagram,
	messenger: IconBrandFacebook
};

export function channelLabel(channel: string): string {
	return channelLabels[channel as Channel] ?? channel;
}

export function channelIcon(channel: string): typeof IconMail {
	return channelIcons[channel as Channel] ?? IconWorld;
}

/**
 * Whether Meta will still deliver a reply on this thread.
 *
 * Instagram and Messenger only accept a message inside a window measured from
 * the contact's last inbound one — seven days, with the HUMAN_AGENT tag the
 * dispatcher applies past the first twenty-four hours. Past that the Graph API
 * refuses, and without this the refusal arrives after a staffer has typed a
 * reply and pressed send.
 *
 * Here rather than inline in the thread page so the rule is testable and reads
 * off the same constant the dispatcher sends on. Every other channel is
 * unaffected: `false` means "nothing is stopping you", not "the window is open".
 *
 * A thread with no inbound message at all is not blocked — staff opened it, and
 * the window has not started.
 */
export function isMetaReplyWindowClosed(
	channel: string,
	messages: { direction: string; createdAt: Date | string }[],
	now: number = Date.now()
): boolean {
	if (channel !== 'instagram' && channel !== 'messenger') return false;

	const lastInbound = messages.findLast((m) => m.direction === 'inbound');
	if (!lastInbound) return false;

	return now - new Date(lastInbound.createdAt).getTime() > META_HUMAN_AGENT_WINDOW_MS;
}
