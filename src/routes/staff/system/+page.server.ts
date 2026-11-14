import { redirectToFirstView } from '../views.server';
import { systemNavItems } from '../nav-items';
import type { StaffView } from '../views';
import type { PageServerLoad } from './$types';

/** The System panel's rows as views: its bare address opens the first one held. */
const systemViews: StaffView[] = systemNavItems.flatMap(({ key, label, href, capability }) =>
	href && capability ? [{ key, label: () => label, href, cap: capability }] : []
);

export const load: PageServerLoad = ({ url }) => redirectToFirstView(systemViews, url);
