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
import { inboxChannels } from '$lib/config';

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
