import { resolve } from '$app/paths';
import { m } from '$lib/paraglide/messages.js';
import type { StaffView } from '../views';

export const moneyViews: readonly StaffView<'payments' | 'credits'>[] = [
	{
		key: 'payments',
		label: () => m.staff_payments_title(),
		href: resolve('/staff/money/payments'),
		cap: 'finance.read'
	},
	{
		key: 'credits',
		label: () => m.staff_credits_title(),
		href: resolve('/staff/money/credits'),
		cap: 'credit.read'
	}
];
