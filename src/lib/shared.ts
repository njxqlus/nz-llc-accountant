export const APP_TIMEZONE = "Pacific/Auckland";
export const GST_RATE = 0.15;
export const GST_RETURN_INCOME = 0;
export const TEMPORARY_ASSET_TTL_SECONDS = 24 * 60 * 60;

export const GST_FILING_FREQUENCIES = [
	"MONTHLY",
	"TWO_MONTHLY",
	"SIX_MONTHLY",
] as const;

export const GST_TWO_MONTHLY_PERIODS = ["ODD", "EVEN"] as const;

export const GST_SIX_MONTHLY_PERIODS = [
	"JAN_JUL",
	"FEB_AUG",
	"MAR_SEP",
	"APR_OCT",
	"MAY_NOV",
	"JUN_DEC",
] as const;

export const GST_FILING_PERIODS = [
	...GST_TWO_MONTHLY_PERIODS,
	...GST_SIX_MONTHLY_PERIODS,
] as const;

export type GstFilingFrequency = (typeof GST_FILING_FREQUENCIES)[number];
export type GstTwoMonthlyPeriod = (typeof GST_TWO_MONTHLY_PERIODS)[number];
export type GstSixMonthlyPeriod = (typeof GST_SIX_MONTHLY_PERIODS)[number];
export type GstFilingPeriod = (typeof GST_FILING_PERIODS)[number];

export type GstSettings = {
	registrationStartDate: string;
	filingFrequency: GstFilingFrequency;
	filingPeriod: GstFilingPeriod | null;
	createdAt: string;
	updatedAt: string;
};

export type SaveGstSettingsResponse = {
	settings: GstSettings;
	resetFilings: boolean;
};

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
	totalGstOnlyExpenses: number;
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

const GST_FILING_PERIOD_END_MONTHS: Record<GstFilingPeriod, number[]> = {
	ODD: [1, 3, 5, 7, 9, 11],
	EVEN: [2, 4, 6, 8, 10, 12],
	JAN_JUL: [1, 7],
	FEB_AUG: [2, 8],
	MAR_SEP: [3, 9],
	APR_OCT: [4, 10],
	MAY_NOV: [5, 11],
	JUN_DEC: [6, 12],
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

export function getGstCycleEndMonths(
	settings: Pick<GstSettings, "filingFrequency" | "filingPeriod">,
): number[] {
	if (settings.filingFrequency === "MONTHLY") {
		return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
	}

	if (!settings.filingPeriod) {
		throw new Error("GST filing period is required for this frequency.");
	}

	return GST_FILING_PERIOD_END_MONTHS[settings.filingPeriod];
}

export function generateGstPeriods(
	settings: Pick<
		GstSettings,
		"registrationStartDate" | "filingFrequency" | "filingPeriod"
	>,
	today = getTodayInTimezone(),
	monthsAhead = 12,
): { periodStart: string; periodEnd: string; dueDate: string }[] {
	const periods: { periodStart: string; periodEnd: string; dueDate: string }[] =
		[];
	const registrationStart = parseIsoDate(settings.registrationStartDate);
	const horizon = endOfMonth(addMonths(parseIsoDate(today), monthsAhead));
	const cycleEndMonths = getGstCycleEndMonths(settings);

	let periodStart = registrationStart;

	while (periodStart.getTime() <= horizon.getTime()) {
		const periodEnd = getNextCycleEnd(periodStart, cycleEndMonths);

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

function getNextCycleEnd(periodStart: Date, cycleEndMonths: number[]): Date {
	const startYear = periodStart.getUTCFullYear();
	const startMonth = periodStart.getUTCMonth() + 1;

	for (let yearOffset = 0; yearOffset <= 1; yearOffset += 1) {
		const year = startYear + yearOffset;

		for (const month of cycleEndMonths) {
			if (yearOffset === 0 && month < startMonth) {
				continue;
			}

			return endOfMonth(new Date(Date.UTC(year, month - 1, 1)));
		}
	}

	throw new Error("Unable to determine GST cycle end.");
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
	const totalGstOnlyExpenses = roundMoney(
		publishedExpenses.reduce(
			(sum, expense) => sum + (expense.gstEnabled ? (expense.amount ?? 0) : 0),
			0,
		),
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
		totalGstOnlyExpenses,
		totalGstRefund: roundMoney(0 - totalGstPaid),
	};
}
