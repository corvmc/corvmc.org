import { redirectToFirstView } from '../views.server';
import { systemNavItems } from '../nav-items';
import type { StaffView } from '../views';
import type { PageServerLoad } from './$types';

/** The System panel's rows as views: its bare address opens the first one held. */
const systemViews: StaffView[] = systemNavItems.map((item) => ({
	key: item.key,
	label: () => item.label,
	href: item.href,
	cap: item.capability!
}));

export const load: PageServerLoad = ({ url }) => redirectToFirstView(systemViews, url);
