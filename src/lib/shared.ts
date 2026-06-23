export const APP_TIMEZONE = "Pacific/Auckland";
export const GST_RATE = 0.15;
export const GST_REGISTRATION_START_DATE = "2025-07-07";
export const GST_FREQUENCY = "TWO_MONTHLY";
export const GST_PERIOD_ENDING_MONTHS = "ODD";
export const GST_RETURN_INCOME = 0;
export const TEMPORARY_ASSET_TTL_SECONDS = 24 * 60 * 60;

export type Expense = {
	id: string;
	title: string;
	expenseDate: string | null;
	amount: number | null;
	gstEnabled: boolean;
	gstAmount: number;
	isDraft: boolean;
	assetId: string | null;
	assetIsTemporary: boolean;
	assetFilename: string | null;
	createdAt: string;
	updatedAt: string;
};

export type GstPeriodFiling = {
	id: string;
	periodStart: string;
	periodEnd: string;
	filed: boolean;
	filedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type GstPeriodSummary = {
	periodStart: string;
	periodEnd: string;
	dueDate: string;
	daysLeft: number;
	filed: boolean;
	filedAt: string | null;
	isCurrent: boolean;
	isUpcoming: boolean;
	isOverdue: boolean;
	expenseCount: number;
	totalSalesAndIncome: number;
	totalGstCollected: number;
	zeroRatedSupplies: number;
	netGstSalesAndIncome: number;
	totalPurchasesAndExpenses: number;
	totalGstPaid: number;
	totalGstRefund: number;
};

export type GstReturnSummary = GstPeriodSummary;

export type ApiError = {
	error: string;
};

export type UploadExpensesResponse = {
	expenses: Expense[];
	failed: { fileName: string; error: string }[];
};

export function roundMoney(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateGstAmount(
	amount: number | null,
	gstEnabled: boolean,
): number {
	if (
		!gstEnabled ||
		amount == null ||
		!Number.isFinite(amount) ||
		amount <= 0
	) {
		return 0;
	}

	return roundMoney((amount * 3) / 23);
}

export function getTodayInTimezone(timeZone = APP_TIMEZONE): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

export function parseIsoDate(value: string): Date {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

	if (!match) {
		throw new Error(`Invalid ISO date: ${value}`);
	}

	const [, year, month, day] = match;
	return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function formatIsoDate(date: Date): string {
	return [
		date.getUTCFullYear(),
		String(date.getUTCMonth() + 1).padStart(2, "0"),
		String(date.getUTCDate()).padStart(2, "0"),
	].join("-");
}

export function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function endOfMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function addMonths(date: Date, months: number): Date {
	return new Date(
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth() + months,
			date.getUTCDate(),
		),
	);
}

export function differenceInDays(
	laterDate: string,
	earlierDate: string,
): number {
	const later = parseIsoDate(laterDate).getTime();
	const earlier = parseIsoDate(earlierDate).getTime();
	return Math.round((later - earlier) / (24 * 60 * 60 * 1000));
}

export function isIsoDate(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeIsoDate(value: string | Date): string {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			throw new Error("Invalid Date object.");
		}

		return formatIsoDate(value);
	}

	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return value;
	}

	const prefix = value.slice(0, 10);

	if (/^\d{4}-\d{2}-\d{2}$/.test(prefix)) {
		return prefix;
	}

	throw new Error(`Invalid ISO date: ${value}`);
}

export function generateGstPeriods(
	today = getTodayInTimezone(),
	monthsAhead = 12,
): { periodStart: string; periodEnd: string; dueDate: string }[] {
	const periods: { periodStart: string; periodEnd: string; dueDate: string }[] =
		[];
	const registrationStart = parseIsoDate(GST_REGISTRATION_START_DATE);
	const horizon = endOfMonth(addMonths(parseIsoDate(today), monthsAhead));

	let periodStart = registrationStart;
	let firstPeriod = true;

	while (periodStart.getTime() <= horizon.getTime()) {
		let periodEnd: Date;

		if (firstPeriod) {
			periodEnd = endOfMonth(periodStart);
			firstPeriod = false;
		} else {
			const monthNumber = periodStart.getUTCMonth() + 1;
			periodEnd =
				monthNumber % 2 === 0
					? endOfMonth(addMonths(periodStart, 1))
					: endOfMonth(periodStart);
		}

		const periodStartIso = formatIsoDate(periodStart);
		const periodEndIso = formatIsoDate(periodEnd);

		periods.push({
			periodStart: periodStartIso,
			periodEnd: periodEndIso,
			dueDate: getGstDueDate(periodEndIso),
		});

		periodStart = addDays(periodEnd, 1);
	}

	return periods;
}

export function getGstDueDate(periodEnd: string): string {
	const end = parseIsoDate(periodEnd);
	const year = end.getUTCFullYear();
	const month = end.getUTCMonth() + 1;
	const day = end.getUTCDate();

	if (month === 3 && day === 31) {
		return `${year}-05-07`;
	}

	if (month === 11 && day === 30) {
		return `${year + 1}-01-15`;
	}

	const nextMonth = month === 12 ? 1 : month + 1;
	const nextMonthYear = month === 12 ? year + 1 : year;
	return `${nextMonthYear}-${String(nextMonth).padStart(2, "0")}-28`;
}

export function buildGstReturnSummary(
	expenses: Expense[],
	periodStart: string,
	periodEnd: string,
	filed: boolean,
	filedAt: string | null,
	today = getTodayInTimezone(),
): GstReturnSummary {
	const publishedExpenses = expenses.filter((expense) => {
		return (
			!expense.isDraft &&
			expense.expenseDate != null &&
			expense.expenseDate >= periodStart &&
			expense.expenseDate <= periodEnd
		);
	});

	const totalPurchasesAndExpenses = roundMoney(
		publishedExpenses.reduce((sum, expense) => sum + (expense.amount ?? 0), 0),
	);
	const totalGstPaid = roundMoney(
		publishedExpenses.reduce((sum, expense) => sum + expense.gstAmount, 0),
	);
	const dueDate = getGstDueDate(periodEnd);
	const daysLeft = differenceInDays(dueDate, today);

	return {
		periodStart,
		periodEnd,
		dueDate,
		daysLeft,
		filed,
		filedAt,
		isCurrent: today >= periodStart && today <= periodEnd,
		isUpcoming: periodStart > today,
		isOverdue: !filed && daysLeft < 0,
		expenseCount: publishedExpenses.length,
		totalSalesAndIncome: GST_RETURN_INCOME,
		totalGstCollected: 0,
		zeroRatedSupplies: 0,
		netGstSalesAndIncome: 0,
		totalPurchasesAndExpenses,
		totalGstPaid,
		totalGstRefund: roundMoney(0 - totalGstPaid),
	};
}
