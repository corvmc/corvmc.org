import { resolve } from '$app/paths';
import { m } from '#lib/paraglide/messages.js';
import type { StaffView } from '../../views';

export const transactionViews: readonly StaffView<'payments' | 'credits'>[] = [
	{
		key: 'payments',
		label: () => m.staff_payments_2_label(),
		href: resolve('staff/system/transactions/payments'),
		cap: 'finance.read'
	},
	{
		key: 'credits',
		label: () => m.staff_credits_label(),
		href: resolve('staff/system/transactions/credits'),
		cap: 'credit.read'
	}
];
