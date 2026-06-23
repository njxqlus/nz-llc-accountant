import { createClient } from "@njxqlus/jean-claude-bun-dam-sdk";
import { serve } from "bun";
import postgres from "postgres";
import index from "./index.html";
import {
	APP_TIMEZONE,
	buildGstReturnSummary,
	calculateGstAmount,
	type Expense,
	type GstPeriodFiling,
	generateGstPeriods,
	getTodayInTimezone,
	isIsoDate,
	roundMoney,
	TEMPORARY_ASSET_TTL_SECONDS,
	type UploadExpensesResponse,
} from "./lib/shared";

type ExpenseRow = {
	id: string;
	title: string;
	expense_date: string | null;
	amount: number | null;
	gst_enabled: boolean;
	gst_amount: number;
	is_draft: boolean;
	asset_id: string | null;
	asset_is_temporary: boolean;
	asset_filename: string | null;
	created_at: string;
	updated_at: string;
};

type GstPeriodFilingRow = {
	id: string;
	period_start: string;
	period_end: string;
	filed: boolean;
	filed_at: string | null;
	created_at: string;
	updated_at: string;
};

type ExpenseInput = {
	title: string;
	expenseDate: string | null;
	amount: number | null;
	gstEnabled: boolean;
};

const PORT = Number(process.env.PORT ?? "3000");
const HOST = process.env.HOST ?? "127.0.0.1";
const DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/nz_llc_accountant";

const sql = postgres(DATABASE_URL, {
	max: 10,
	idle_timeout: 5,
	prepare: false,
	onnotice() {
		return undefined;
	},
});

const mediaClient = createClient();

await initializeDatabase();

const server = serve({
	hostname: HOST,
	port: PORT,
	routes: {
		"/api/expenses": {
			async GET() {
				return jsonResponse(await listExpenses());
			},
		},
		"/api/expenses/manual": {
			async POST(request) {
				try {
					const payload = await request.json();
					const expense = await createManualExpense(payload);
					return jsonResponse(expense, { status: 201 });
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/api/expenses/upload": {
			async POST(request) {
				try {
					const formData = await request.formData();
					const fileEntries = formData.getAll("files");
					const files = fileEntries.filter(
						(entry): entry is File => entry instanceof File,
					);

					if (files.length === 0) {
						throw new HttpError(400, "At least one file is required.");
					}

					const result = await uploadExpenses(files);
					return jsonResponse(result, { status: 201 });
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/api/expenses/:id": {
			async GET(request) {
				try {
					const expense = await getExpenseOrThrow(request.params.id);
					return jsonResponse(expense);
				} catch (error) {
					return handleError(error);
				}
			},
			async PATCH(request) {
				try {
					const payload = await request.json();
					const expense = await updateExpense(request.params.id, payload);
					return jsonResponse(expense);
				} catch (error) {
					return handleError(error);
				}
			},
			async DELETE(request) {
				try {
					await deleteExpense(request.params.id);
					return new Response(null, { status: 204 });
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/api/expenses/:id/publish": {
			async POST(request) {
				try {
					const expense = await publishExpense(request.params.id);
					return jsonResponse(expense);
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/api/assets/:id/file": {
			async GET(request) {
				try {
					const download = await mediaClient.getAssetFile(request.params.id);
					return new Response(download.response.body, {
						status: download.response.status,
						headers: copyDownloadHeaders(download.response.headers),
					});
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/api/gst/periods": {
			async GET() {
				try {
					return jsonResponse(await buildGstPeriodsResponse());
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/api/gst/periods/:periodStart/:periodEnd/return": {
			async GET(request) {
				try {
					const summary = await getGstReturn(
						request.params.periodStart,
						request.params.periodEnd,
					);
					return jsonResponse(summary);
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/api/gst/periods/:periodStart/:periodEnd/mark-filed": {
			async POST(request) {
				try {
					const filing = await setPeriodFiled(
						request.params.periodStart,
						request.params.periodEnd,
						true,
					);
					return jsonResponse(filing);
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/api/gst/periods/:periodStart/:periodEnd/unmark-filed": {
			async POST(request) {
				try {
					const filing = await setPeriodFiled(
						request.params.periodStart,
						request.params.periodEnd,
						false,
					);
					return jsonResponse(filing);
				} catch (error) {
					return handleError(error);
				}
			},
		},
		"/*": index,
	},
	development: process.env.NODE_ENV !== "production" && {
		hmr: true,
		console: true,
	},
});

console.log(
	`GST tracker running at http://${server.hostname}:${server.port} (${APP_TIMEZONE})`,
);

async function initializeDatabase() {
	await sql`
		create table if not exists expenses (
			id uuid primary key,
			title text not null default '',
			expense_date date,
			amount double precision,
			gst_enabled boolean not null default false,
			gst_amount double precision not null default 0,
			is_draft boolean not null default true,
			asset_id text,
			asset_is_temporary boolean not null default false,
			asset_filename text,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		)
	`;

	await sql`
		create table if not exists gst_period_filings (
			id uuid primary key,
			period_start date not null,
			period_end date not null,
			filed boolean not null default false,
			filed_at timestamptz,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now(),
			unique(period_start, period_end)
		)
	`;

	await sql`
		create index if not exists expenses_expense_date_idx
		on expenses (expense_date desc nulls last, created_at desc)
	`;
}

async function listExpenses(): Promise<Expense[]> {
	const rows = await sql<ExpenseRow[]>`
		select *
		from expenses
		order by expense_date desc nulls last, created_at desc
	`;
	return rows.map(mapExpenseRow);
}

async function getExpenseOrThrow(id: string): Promise<Expense> {
	const row = await findExpenseRow(id);

	if (!row) {
		throw new HttpError(404, "Expense not found.");
	}

	return mapExpenseRow(row);
}

async function createManualExpense(payload: unknown): Promise<Expense> {
	const input = normalizeExpenseInput(payload);
	validateDraftExpense(input, false);

	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	const amount = input.amount == null ? null : roundMoney(input.amount);
	const gstAmount = calculateGstAmount(amount, input.gstEnabled);

	const [row] = await sql<ExpenseRow[]>`
		insert into expenses (
			id,
			title,
			expense_date,
			amount,
			gst_enabled,
			gst_amount,
			is_draft,
			asset_id,
			asset_is_temporary,
			asset_filename,
			created_at,
			updated_at
		) values (
			${id},
			${input.title},
			${input.expenseDate},
			${amount},
			${input.gstEnabled},
			${gstAmount},
			true,
			${null},
			false,
			${null},
			${now},
			${now}
		)
		returning *
	`;

	return mapExpenseRow(ensureRow(row, "Failed to create manual expense."));
}

async function uploadExpenses(files: File[]): Promise<UploadExpensesResponse> {
	const result: UploadExpensesResponse = {
		expenses: [],
		failed: [],
	};

	for (const file of files) {
		try {
			const asset = await mediaClient.createAsset({
				file,
				filename: file.name,
				metadata: {
					originalFilename: file.name,
				},
				temporary: true,
				ttlSeconds: TEMPORARY_ASSET_TTL_SECONDS,
			});

			const now = new Date().toISOString();
			const [row] = await sql<ExpenseRow[]>`
				insert into expenses (
					id,
					title,
					expense_date,
					amount,
					gst_enabled,
					gst_amount,
					is_draft,
					asset_id,
					asset_is_temporary,
					asset_filename,
					created_at,
					updated_at
				) values (
					${crypto.randomUUID()},
					'',
					${null},
					${null},
					false,
					0,
					true,
					${asset.id},
					true,
					${file.name},
					${now},
					${now}
				)
				returning *
			`;

			result.expenses.push(
				mapExpenseRow(
					ensureRow(row, "Failed to create uploaded draft expense."),
				),
			);
		} catch (error) {
			result.failed.push({
				fileName: file.name,
				error: getErrorMessage(error),
			});
		}
	}

	return result;
}

async function updateExpense(id: string, payload: unknown): Promise<Expense> {
	const row = await findExpenseRow(id);

	if (!row) {
		throw new HttpError(404, "Expense not found.");
	}

	const existing = mapExpenseRow(row);
	const input = normalizeExpenseInput(payload, existing);
	const isUploadDraft = existing.assetId != null;

	if (existing.isDraft) {
		validateDraftExpense(input, isUploadDraft);
	} else {
		validatePublishedExpense(input);
	}

	const amount = input.amount == null ? null : roundMoney(input.amount);
	const gstAmount = calculateGstAmount(amount, input.gstEnabled);
	const [updated] = await sql<ExpenseRow[]>`
		update expenses
		set
			title = ${input.title},
			expense_date = ${input.expenseDate},
			amount = ${amount},
			gst_enabled = ${input.gstEnabled},
			gst_amount = ${gstAmount},
			updated_at = now()
		where id = ${id}
		returning *
	`;

	return mapExpenseRow(ensureRow(updated, "Failed to update expense."));
}

async function publishExpense(id: string): Promise<Expense> {
	const row = await findExpenseRow(id);

	if (!row) {
		throw new HttpError(404, "Expense not found.");
	}

	const expense = mapExpenseRow(row);
	validatePublishedExpense({
		title: expense.title,
		expenseDate: expense.expenseDate,
		amount: expense.amount,
		gstEnabled: expense.gstEnabled,
	});

	if (expense.assetId && expense.assetIsTemporary) {
		await mediaClient.finalizeAsset(expense.assetId);
	}

	const gstAmount = calculateGstAmount(expense.amount, expense.gstEnabled);
	const [published] = await sql<ExpenseRow[]>`
		update expenses
		set
			gst_amount = ${gstAmount},
			is_draft = false,
			asset_is_temporary = false,
			updated_at = now()
		where id = ${id}
		returning *
	`;

	return mapExpenseRow(ensureRow(published, "Failed to publish expense."));
}

async function deleteExpense(id: string): Promise<void> {
	const row = await findExpenseRow(id);

	if (!row) {
		throw new HttpError(404, "Expense not found.");
	}

	const expense = mapExpenseRow(row);

	if (expense.assetId) {
		try {
			await mediaClient.deleteAsset(expense.assetId);
		} catch (error) {
			throw new HttpError(
				502,
				`File deletion failed. The expense was not removed. ${getErrorMessage(error)}`,
			);
		}
	}

	await sql`
		delete from expenses
		where id = ${id}
	`;
}

async function buildGstPeriodsResponse() {
	const [expenses, filings] = await Promise.all([
		listExpenses(),
		listPeriodFilings(),
	]);
	const filingMap = new Map(
		filings.map((filing) => [
			periodKey(filing.periodStart, filing.periodEnd),
			filing,
		]),
	);
	const today = getTodayInTimezone();

	return generateGstPeriods(today).map((period) => {
		const filing = filingMap.get(
			periodKey(period.periodStart, period.periodEnd),
		);
		return buildGstReturnSummary(
			expenses,
			period.periodStart,
			period.periodEnd,
			filing?.filed ?? false,
			filing?.filedAt ?? null,
			today,
		);
	});
}

async function getGstReturn(periodStart: string, periodEnd: string) {
	if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) {
		throw new HttpError(400, "Invalid period.");
	}

	const [expenses, filing] = await Promise.all([
		listExpenses(),
		findPeriodFiling(periodStart, periodEnd),
	]);

	return buildGstReturnSummary(
		expenses,
		periodStart,
		periodEnd,
		filing?.filed ?? false,
		filing?.filedAt ?? null,
	);
}

async function setPeriodFiled(
	periodStart: string,
	periodEnd: string,
	filed: boolean,
): Promise<GstPeriodFiling> {
	if (!isIsoDate(periodStart) || !isIsoDate(periodEnd)) {
		throw new HttpError(400, "Invalid period.");
	}

	const filedAt = filed ? new Date().toISOString() : null;
	const [row] = await sql<GstPeriodFilingRow[]>`
		insert into gst_period_filings (
			id,
			period_start,
			period_end,
			filed,
			filed_at,
			created_at,
			updated_at
		) values (
			${crypto.randomUUID()},
			${periodStart},
			${periodEnd},
			${filed},
			${filedAt},
			now(),
			now()
		)
		on conflict (period_start, period_end)
		do update set
			filed = excluded.filed,
			filed_at = excluded.filed_at,
			updated_at = now()
		returning *
	`;

	return mapPeriodFilingRow(
		ensureRow(row, "Failed to update GST filing state."),
	);
}

async function listPeriodFilings(): Promise<GstPeriodFiling[]> {
	const rows = await sql<GstPeriodFilingRow[]>`
		select *
		from gst_period_filings
	`;
	return rows.map(mapPeriodFilingRow);
}

async function findPeriodFiling(
	periodStart: string,
	periodEnd: string,
): Promise<GstPeriodFiling | null> {
	const [row] = await sql<GstPeriodFilingRow[]>`
		select *
		from gst_period_filings
		where period_start = ${periodStart}
			and period_end = ${periodEnd}
		limit 1
	`;

	return row ? mapPeriodFilingRow(row) : null;
}

async function findExpenseRow(id: string): Promise<ExpenseRow | undefined> {
	const [row] = await sql<ExpenseRow[]>`
		select *
		from expenses
		where id = ${id}
		limit 1
	`;
	return row;
}

function normalizeExpenseInput(
	payload: unknown,
	fallback?: Expense,
): ExpenseInput {
	if (payload == null || typeof payload !== "object") {
		throw new HttpError(400, "Invalid expense payload.");
	}

	const record = payload as Record<string, unknown>;
	const titleValue = record.title ?? fallback?.title ?? "";
	const title =
		typeof titleValue === "string"
			? titleValue.trim()
			: String(titleValue ?? "");

	const rawDate = record.expenseDate ?? fallback?.expenseDate ?? null;
	let expenseDate: string | null;

	if (rawDate == null || rawDate === "") {
		expenseDate = null;
	} else if (isIsoDate(rawDate)) {
		expenseDate = rawDate;
	} else {
		throw new HttpError(400, "Expense date must be in YYYY-MM-DD format.");
	}

	const rawAmount = record.amount ?? fallback?.amount ?? null;
	let amount: number | null;

	if (rawAmount == null || rawAmount === "") {
		amount = null;
	} else {
		amount = Number(rawAmount);
		if (!Number.isFinite(amount)) {
			throw new HttpError(400, "Amount must be numeric.");
		}
	}

	const gstValue = record.gstEnabled ?? fallback?.gstEnabled;

	if (typeof gstValue !== "boolean") {
		throw new HttpError(400, "gstEnabled must be boolean.");
	}

	return {
		title,
		expenseDate,
		amount,
		gstEnabled: gstValue,
	};
}

function validateDraftExpense(input: ExpenseInput, allowEmptyTitle: boolean) {
	if (!allowEmptyTitle && input.title.length === 0) {
		throw new HttpError(400, "Draft manual expenses require a title.");
	}

	if (input.amount != null && input.amount <= 0) {
		throw new HttpError(400, "Amount must be greater than 0 when provided.");
	}
}

function validatePublishedExpense(input: ExpenseInput) {
	if (input.title.length === 0) {
		throw new HttpError(400, "Published expenses require a title.");
	}

	if (!input.expenseDate) {
		throw new HttpError(400, "Published expenses require an expense date.");
	}

	if (input.amount == null || input.amount <= 0) {
		throw new HttpError(
			400,
			"Published expenses require an amount greater than 0.",
		);
	}
}

function mapExpenseRow(row: ExpenseRow): Expense {
	return {
		id: row.id,
		title: row.title,
		expenseDate: row.expense_date,
		amount: row.amount == null ? null : Number(row.amount),
		gstEnabled: row.gst_enabled,
		gstAmount: Number(row.gst_amount),
		isDraft: row.is_draft,
		assetId: row.asset_id,
		assetIsTemporary: row.asset_is_temporary,
		assetFilename: row.asset_filename,
		createdAt: new Date(row.created_at).toISOString(),
		updatedAt: new Date(row.updated_at).toISOString(),
	};
}

function mapPeriodFilingRow(row: GstPeriodFilingRow): GstPeriodFiling {
	return {
		id: row.id,
		periodStart: row.period_start,
		periodEnd: row.period_end,
		filed: row.filed,
		filedAt: row.filed_at ? new Date(row.filed_at).toISOString() : null,
		createdAt: new Date(row.created_at).toISOString(),
		updatedAt: new Date(row.updated_at).toISOString(),
	};
}

function periodKey(periodStart: string, periodEnd: string): string {
	return `${periodStart}:${periodEnd}`;
}

function ensureRow<T>(row: T | undefined, message: string): T {
	if (!row) {
		throw new HttpError(500, message);
	}

	return row;
}

function jsonResponse(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, init);
}

function handleError(error: unknown): Response {
	if (error instanceof HttpError) {
		return jsonResponse({ error: error.message }, { status: error.status });
	}

	console.error(error);
	return jsonResponse(
		{ error: getErrorMessage(error) || "Unexpected server error." },
		{ status: 500 },
	);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Unknown error.";
}

function copyDownloadHeaders(headers: Headers): Headers {
	const responseHeaders = new Headers();
	const allowedHeaders = [
		"content-type",
		"content-length",
		"content-disposition",
		"cache-control",
		"etag",
		"last-modified",
	];

	for (const header of allowedHeaders) {
		const value = headers.get(header);
		if (value) {
			responseHeaders.set(header, value);
		}
	}

	return responseHeaders;
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		void sql.end({ timeout: 5 }).finally(() => process.exit(0));
	});
}
