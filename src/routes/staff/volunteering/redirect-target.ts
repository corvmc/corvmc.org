/**
 * Where an old Schedule address lands (#2625). Work with no shift and
 * contractor work are Tasks'; everything else is a shift, which is
 * Volunteering's, keeping the window, role and queue it named.
 */
export function volunteeringTarget(params: URLSearchParams): string {
	const kind = params.get('kind');
	if (kind === 'contractor' || kind === 'untimed') {
		const invoice = kind === 'contractor' && params.get('contractor') === 'awaiting-invoice';
		return `/staff/tasks?kind=${kind}${invoice ? '&chip=invoice' : ''}`;
	}
	// The unassigned queue became Tasks' chip.
	if (params.get('needs') === 'unassigned') return '/staff/tasks?chip=unassigned';
	const keep = new URLSearchParams();
	for (const key of ['days', 'role', 'needs', 'short']) {
		const value = params.get(key);
		if (value) keep.set(key, value);
	}
	const search = keep.toString();
	return `/staff/volunteering${search ? `?${search}` : ''}`;
}
