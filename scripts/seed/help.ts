import { helpArticle, helpCategory } from '../../src/lib/server/db/schema/help';
import { batchInsert } from './db';

export async function seedHelp() {
	const cats = await batchInsert(
		helpCategory,
		[
			{
				name: 'Getting Started',
				slug: 'getting-started',
				description: 'Learn the basics of your membership',
				icon: 'book',
				sortOrder: 0,
				minRole: 'member'
			},
			{
				name: 'Reservations',
				slug: 'reservations',
				description: 'Booking rooms and managing your time',
				icon: 'calendar',
				sortOrder: 1,
				minRole: 'member'
			},
			{
				name: 'Bands',
				slug: 'bands',
				description: 'Creating and managing bands',
				icon: 'music',
				sortOrder: 3,
				minRole: 'member'
			},
			{
				name: 'Staff Guide',
				slug: 'staff-guide',
				description: 'Operations and admin tasks',
				icon: 'settings',
				sortOrder: 8,
				minRole: 'staff'
			},
			{
				name: 'Profile & Directory',
				slug: 'profile-directory',
				description: 'Your profile, visibility, and being found',
				icon: 'user',
				sortOrder: 2,
				minRole: 'member'
			},
			{
				name: 'Band Pages (Premium)',
				slug: 'band-pages',
				description: 'Premium band websites, page editor, and press kit',
				icon: 'layout',
				sortOrder: 4,
				minRole: 'member'
			},
			{
				name: 'Events & Tickets',
				slug: 'events-tickets',
				description: 'Browsing events, buying tickets, and check-in',
				icon: 'ticket',
				sortOrder: 5,
				minRole: 'member'
			},
			{
				name: 'Equipment Lending',
				slug: 'equipment',
				description: 'Borrowing gear from the lending library',
				icon: 'package',
				sortOrder: 6,
				minRole: 'member'
			},
			{
				name: 'Membership & Billing',
				slug: 'membership',
				description: 'Sustaining membership, benefits, and billing',
				icon: 'heart',
				sortOrder: 7,
				minRole: 'member'
			},
			{
				name: 'Volunteering',
				slug: 'volunteering',
				description: 'Volunteer roles, logging hours, and how review works',
				icon: 'heart-handshake',
				sortOrder: 9,
				minRole: 'member'
			},
			{
				name: 'Messages',
				slug: 'messaging',
				description: 'Talking to staff, and to other members',
				icon: 'message',
				sortOrder: 10,
				minRole: 'member'
			},
			{
				name: 'Suggestions',
				slug: 'suggestions',
				description: 'The member idea board and how staff answer it',
				icon: 'bulb',
				sortOrder: 11,
				minRole: 'member'
			}
		],
		9
	);

	const articles = await batchInsert(
		helpArticle,
		[
			{
				categoryId: cats[0].id,
				title: 'Welcome to CorvMC',
				slug: 'welcome',
				summary: 'An overview of your membership and what you can do.',
				content:
					'## Welcome\n\nCorvMC is a community music space where you can book rehearsal rooms, connect with other musicians, and join bands.\n\n## What You Can Do\n\n- **Book Reservations** — Reserve practice rooms by the hour\n- **Join the Directory** — Share your instruments and genres so others can find you\n- **Create or Join Bands** — Collaborate with other members\n- **Attend Events** — Check out shows and community events',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 0
			},
			{
				categoryId: cats[0].id,
				title: 'Your Profile',
				slug: 'your-profile',
				summary: 'How to set up and customize your member profile.',
				content:
					'## Your Profile\n\nYour profile helps other members find you in the directory.\n\n### What to Add\n\n- **Instruments** — What do you play?\n- **Genres** — What styles are you into?\n- **Looking for a band** — Toggle this to show up in searches\n\n### Updating Your Profile\n\nNavigate to your account settings to update your display name, pronouns, and contact info.',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 1
			},
			{
				categoryId: cats[1].id,
				title: 'Booking a Session',
				slug: 'booking-a-session',
				summary: 'How to reserve practice time at the studio.',
				content:
					'## Booking a Session\n\nYou can book a rehearsal room from your member dashboard.\n\n### How to Book\n\n1. Navigate to **Reservations** in the sidebar\n2. Select an available time slot\n3. Choose the duration (1-4 hours)\n4. Confirm your booking\n\n### Cancellation Policy\n\nYou can cancel up to 24 hours before the start time without charge.',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 0
			},
			{
				categoryId: cats[1].id,
				title: 'Recurring Reservations',
				slug: 'recurring-reservations',
				summary: 'Set up weekly or biweekly practice schedules.',
				content:
					'## Recurring Reservations\n\nIf you practice at the same time each week, set up a recurring reservation.\n\n### How It Works\n\n- Choose weekly, biweekly, or monthly frequency\n- Recurring reservations are created in advance\n- You can skip individual occurrences without cancelling the series\n\n### Eligibility\n\nRecurring reservations are available to sustaining members and above.',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 1
			},
			{
				categoryId: cats[2].id,
				title: 'Creating a Band',
				slug: 'creating-a-band',
				summary: 'How to create a band and invite members.',
				content:
					'## Creating a Band\n\nBands allow you to share a practice schedule and coordinate with other members.\n\n### Steps\n\n1. Go to **My Bands** in the sidebar\n2. Click **Create Band**\n3. Name your band and add a bio\n4. Invite members by searching the directory\n\n### Roles\n\n- **Owner** — Full control, can delete the band\n- **Admin** — Can manage members and book on behalf of the band\n- **Member** — Can view the schedule and band info',
				source: 'static',
				minRole: 'member',
				published: true,
				sortOrder: 0
			},
			{
				categoryId: cats[3].id,
				title: 'Managing Reservations',
				slug: 'staff-managing-reservations',
				summary: 'How to confirm, complete, and resolve reservations.',
				content:
					"## Managing Reservations\n\nAs staff, you can manage all member reservations.\n\n### Actions\n\n- **Confirm** — Approve a pending reservation\n- **Complete** — Mark as done after the session\n- **No-show** — Mark if the member didn't arrive\n- **Cancel** — Cancel with an optional reason\n\n### Resolving Issues\n\nUse the Resolve panel to handle unresolved reservations (past their end time but not completed).",
				source: 'static',
				minRole: 'staff',
				published: true,
				sortOrder: 0
			}
		],
		6
	);

	return { categories: cats.length, articles: articles.length };
}
