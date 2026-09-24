import { domainEvents } from '$lib/server/event-bus';
import { dispatch, dispatchEmailOnly } from '$lib/server/notification/dispatcher';
import { listUsersWithCapability } from '$lib/server/authorization';
import { captureException } from '$lib/server/sentry';

/**
 * Public tips for the local resources directory (#1498). Staff hear one arrived,
 * in-app, since the queue has no badge. The submitter may have no account, so
 * the outcome goes by email only, to the address the tip left.
 */
export function registerLocalResourceListeners(): void {
	domainEvents.on('local_resource.submitted', async ({ data: event }) => {
		const staff = await listUsersWithCapability('localResource.manage');
		for (const member of staff) {
			try {
				await dispatch({
					type: 'local_resource_submitted',
					userId: member.id,
					userEmail: member.email,
					title: `Suggested for the local resources page: ${event.name}`,
					body: 'A public tip is waiting for review',
					href: `/staff/local-resources/${event.resourceId}`
				});
			} catch (err) {
				captureException(err, { event: 'notification.local_resource_submitted' });
			}
		}
	});

	domainEvents.on('local_resource.reviewed', async ({ data: event }) => {
		const live = event.published;
		await dispatchEmailOnly({
			type: 'local_resource_reviewed',
			toEmail: event.submitterEmail,
			email: {
				subject: live
					? `${event.name} is on our local resources page`
					: `About your local resources tip: ${event.name}`,
				heading: live ? 'Your suggestion is listed' : 'We did not list your suggestion yet',
				paragraphs: [
					{
						text: live
							? `Thanks for the tip. ${event.name} is now on the Corvallis Music Collective's local resources page.`
							: `Thanks for suggesting ${event.name}. We have not listed it yet. Our note is below, and you are welcome to send it again with the details changed.`
					}
				],
				...(event.staffNote ? { quote: event.staffNote } : {}),
				cta: { url: '/local-resources', label: 'See local resources' }
			}
		});
	});
}
