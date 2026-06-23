import {
	AlertCircleIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	CircleDashedIcon,
	CopyIcon,
	FileUpIcon,
	FolderOpenIcon,
	PlusIcon,
	ReceiptTextIcon,
	RefreshCwIcon,
	Trash2Icon,
} from "lucide-react";
import {
	useEffect,
	useEffectEvent,
	useRef,
	useState,
	useTransition,
} from "react";
import { Toaster, toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type {
	Expense,
	GstPeriodSummary,
	GstReturnSummary,
	UploadExpensesResponse,
} from "@/lib/shared";
import { calculateGstAmount, normalizeIsoDate, roundMoney } from "@/lib/shared";
import "./index.css";

type EditorState = {
	id: string | null;
	title: string;
	expenseDate: string;
	amount: string;
	gstEnabled: boolean;
	isDraft: boolean;
	assetId: string | null;
	assetFilename: string | null;
	assetIsTemporary: boolean;
};

type SortOrder = "newest" | "oldest";
const currencyFormatter = new Intl.NumberFormat("en-NZ", {
	style: "currency",
	currency: "NZD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en-NZ", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

function createBlankEditor(): EditorState {
	return {
		id: null,
		title: "",
		expenseDate: "",
		amount: "",
		gstEnabled: false,
		isDraft: true,
		assetId: null,
		assetFilename: null,
		assetIsTemporary: false,
	};
}

function expenseToEditor(expense: Expense): EditorState {
	return {
		id: expense.id,
		title: expense.title,
		expenseDate:
			expense.expenseDate == null ? "" : normalizeIsoDate(expense.expenseDate),
		amount: expense.amount == null ? "" : expense.amount.toFixed(2),
		gstEnabled: expense.gstEnabled,
		isDraft: expense.isDraft,
		assetId: expense.assetId,
		assetFilename: expense.assetFilename,
		assetIsTemporary: expense.assetIsTemporary,
	};
}

function formatCurrency(value: number): string {
	return currencyFormatter.format(value);
}

function formatDate(value: string): string {
	return dateFormatter.format(new Date(`${normalizeIsoDate(value)}T00:00:00`));
}

function formatDateTime(value: string): string {
	return dateFormatter.format(new Date(value));
}

function formatPeriodRange(period: {
	periodStart: string;
	periodEnd: string;
}): string {
	return `${formatDate(period.periodStart)} to ${formatDate(period.periodEnd)}`;
}

function getPeriodStatusLabel(period: GstPeriodSummary): string {
	if (period.filed) {
		return "Filed";
	}

	if (period.daysLeft < 0) {
		const overdueDays = Math.abs(period.daysLeft);
		return `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}`;
	}

	return `${period.daysLeft} day${period.daysLeft === 1 ? "" : "s"} left to file`;
}

function getRefundTone(value: number): string {
	if (value < 0) {
		return "text-amber-700";
	}

	if (value > 0) {
		return "text-emerald-700";
	}

	return "text-foreground";
}

function getExpenseSortValue(expense: Expense): number {
	const basis = expense.expenseDate
		? `${normalizeIsoDate(expense.expenseDate)}T12:00:00`
		: expense.createdAt;
	return new Date(basis).getTime();
}

async function fetchJson<T>(
	input: RequestInfo,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(input, {
		cache: "no-store",
		...init,
	});

	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(payload?.error ?? `Request failed with ${response.status}`);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return (await response.json()) as T;
}

function upsertExpense(expenses: Expense[], nextExpense: Expense): Expense[] {
	const existingIndex = expenses.findIndex(
		(expense) => expense.id === nextExpense.id,
	);

	if (existingIndex === -1) {
		return [nextExpense, ...expenses];
	}

	const nextExpenses = [...expenses];
	nextExpenses[existingIndex] = nextExpense;
	return nextExpenses;
}

async function copyValue(label: string, value: string) {
	await navigator.clipboard.writeText(value);
	toast.success(`${label} copied`);
}

function ReturnValueRow({
	label,
	value,
	onCopy,
}: {
	label: string;
	value: number;
	onCopy: () => Promise<void>;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
			<div>
				<p className="text-sm text-muted-foreground">{label}</p>
				<p className={`text-lg font-semibold ${getRefundTone(value)}`}>
					{formatCurrency(value)}
				</p>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={() => void onCopy()}
			>
				<CopyIcon data-icon="inline-start" />
				Copy
			</Button>
		</div>
	);
}

export function App() {
	const uploadInputRef = useRef<HTMLInputElement | null>(null);
	const [expenses, setExpenses] = useState<Expense[]>([]);
	const [periods, setPeriods] = useState<GstPeriodSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [uploading, setUploading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [refreshing, startRefreshTransition] = useTransition();
	const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
	const [historyOpen, setHistoryOpen] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [isEditorOpen, setIsEditorOpen] = useState(false);
	const [editor, setEditor] = useState<EditorState>(createBlankEditor);
	const [returnDialogOpen, setReturnDialogOpen] = useState(false);
	const [returnSummary, setReturnSummary] = useState<GstReturnSummary | null>(
		null,
	);
	const [returnLoading, setReturnLoading] = useState(false);

	const loadDashboard = useEffectEvent(async (showSpinner = false) => {
		if (showSpinner) {
			setLoading(true);
		}

		try {
			setError(null);
			const [nextExpenses, nextPeriods] = await Promise.all([
				fetchJson<Expense[]>("/api/expenses"),
				fetchJson<GstPeriodSummary[]>("/api/gst/periods"),
			]);
			setExpenses(nextExpenses);
			setPeriods(nextPeriods);
		} catch (loadError) {
			const message =
				loadError instanceof Error
					? loadError.message
					: "Failed to load dashboard.";
			setError(message);
		} finally {
			if (showSpinner) {
				setLoading(false);
			}
		}
	});

	useEffect(() => {
		void loadDashboard(true);
	}, []);

	const sortedExpenses = [...expenses].sort((left, right) => {
		const leftValue = getExpenseSortValue(left);
		const rightValue = getExpenseSortValue(right);

		return sortOrder === "newest"
			? rightValue - leftValue
			: leftValue - rightValue;
	});

	const currentPeriodIndex = periods.findIndex((period) => period.isCurrent);
	const currentPeriod =
		currentPeriodIndex >= 0 ? periods[currentPeriodIndex] : undefined;
	const previousPeriod =
		currentPeriodIndex > 0 ? periods[currentPeriodIndex - 1] : undefined;
	const visiblePeriods = [
		previousPeriod && !previousPeriod.filed ? previousPeriod : undefined,
		currentPeriod,
	].filter((period): period is GstPeriodSummary => period != null);
	const historyPeriods =
		currentPeriodIndex > 0
			? periods.slice(
					0,
					previousPeriod && !previousPeriod.filed
						? currentPeriodIndex - 1
						: currentPeriodIndex,
				)
			: [];

	function refreshDashboard() {
		startRefreshTransition(() => {
			void loadDashboard();
		});
	}

	function openManualExpenseEditor() {
		setEditor(createBlankEditor());
		setIsEditorOpen(true);
	}

	function openExpenseEditor(expense: Expense) {
		setEditor(expenseToEditor(expense));
		setIsEditorOpen(true);
	}

	async function saveExpense(publishAfterSave: boolean) {
		setSaving(true);

		try {
			const payload = {
				title: editor.title,
				expenseDate: editor.expenseDate || null,
				amount: editor.amount === "" ? null : Number(editor.amount),
				gstEnabled: editor.gstEnabled,
			};

			let expenseId = editor.id;
			let savedExpense: Expense | null = null;

			if (expenseId == null) {
				const created = await fetchJson<Expense>("/api/expenses/manual", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				expenseId = created.id;
				savedExpense = created;
			} else {
				savedExpense = await fetchJson<Expense>(`/api/expenses/${expenseId}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
			}

			if (publishAfterSave && expenseId) {
				savedExpense = await fetchJson<Expense>(
					`/api/expenses/${expenseId}/publish`,
					{
						method: "POST",
					},
				);
			}

			if (savedExpense) {
				setExpenses((currentExpenses) =>
					upsertExpense(currentExpenses, savedExpense),
				);
			}

			setIsEditorOpen(false);
			setEditor(createBlankEditor());
			toast.success(
				publishAfterSave ? "Expense published." : "Draft expense saved.",
			);
			refreshDashboard();
		} catch (saveError) {
			toast.error(
				saveError instanceof Error
					? saveError.message
					: "Unable to save expense.",
			);
		} finally {
			setSaving(false);
		}
	}

	async function deleteExpense(id: string) {
		const confirmed = window.confirm(
			"Delete this expense and its linked media asset permanently?",
		);

		if (!confirmed) {
			return;
		}

		try {
			await fetchJson<void>(`/api/expenses/${id}`, { method: "DELETE" });
			toast.success("Expense deleted.");
			if (editor.id === id) {
				setIsEditorOpen(false);
				setEditor(createBlankEditor());
			}
			refreshDashboard();
		} catch (deleteError) {
			toast.error(
				deleteError instanceof Error
					? deleteError.message
					: "Unable to delete expense.",
			);
		}
	}

	async function publishExpense(id: string) {
		try {
			const publishedExpense = await fetchJson<Expense>(
				`/api/expenses/${id}/publish`,
				{
					method: "POST",
				},
			);
			setExpenses((currentExpenses) =>
				upsertExpense(currentExpenses, publishedExpense),
			);
			toast.success("Expense published.");
			refreshDashboard();
		} catch (publishError) {
			toast.error(
				publishError instanceof Error
					? publishError.message
					: "Unable to publish expense.",
			);
		}
	}

	async function loadReturnSummary(period: GstPeriodSummary) {
		setReturnDialogOpen(true);
		setReturnLoading(true);

		try {
			const summary = await fetchJson<GstReturnSummary>(
				`/api/gst/periods/${period.periodStart}/${period.periodEnd}/return`,
			);
			setReturnSummary(summary);
		} catch (returnError) {
			toast.error(
				returnError instanceof Error
					? returnError.message
					: "Unable to load GST return.",
			);
			setReturnDialogOpen(false);
		} finally {
			setReturnLoading(false);
		}
	}

	async function togglePeriodFiled(period: GstPeriodSummary, filed: boolean) {
		try {
			await fetchJson(
				`/api/gst/periods/${period.periodStart}/${period.periodEnd}/${filed ? "mark-filed" : "unmark-filed"}`,
				{ method: "POST" },
			);
			toast.success(
				filed ? "Period marked as filed." : "Filed marker removed.",
			);
			refreshDashboard();
		} catch (toggleError) {
			toast.error(
				toggleError instanceof Error
					? toggleError.message
					: "Unable to update filed status.",
			);
		}
	}

	async function uploadFiles(files: FileList | File[]) {
		const list = Array.from(files);

		if (list.length === 0) {
			return;
		}

		setUploading(true);

		try {
			const formData = new FormData();
			for (const file of list) {
				formData.append("files", file);
			}

			const response = await fetchJson<UploadExpensesResponse>(
				"/api/expenses/upload",
				{
					method: "POST",
					body: formData,
				},
			);

			if (response.expenses.length > 0) {
				toast.success(
					`${response.expenses.length} draft expense${response.expenses.length === 1 ? "" : "s"} created.`,
				);
			}

			if (response.failed.length > 0) {
				toast.error(
					`${response.failed.length} file${response.failed.length === 1 ? "" : "s"} failed to upload.`,
				);
			}

			refreshDashboard();
		} catch (uploadError) {
			toast.error(
				uploadError instanceof Error ? uploadError.message : "Upload failed.",
			);
		} finally {
			setUploading(false);
		}
	}

	const editorAmount = editor.amount === "" ? null : Number(editor.amount);
	const liveGstAmount = calculateGstAmount(
		Number.isFinite(editorAmount) ? editorAmount : null,
		editor.gstEnabled,
	);

	return (
		<div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_36%),linear-gradient(180deg,#f5f1e8_0%,#efe7d8_46%,#ece4d6_100%)] text-foreground">
			<Toaster richColors position="top-right" />
			<div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
				{error ? (
					<Alert variant="destructive">
						<AlertCircleIcon />
						<AlertTitle>Dashboard unavailable</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}

				<section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
					<Card className="border-white/60 bg-white/88 shadow-sm backdrop-blur">
						<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
							<div className="flex flex-col gap-1">
								<CardTitle>GST periods</CardTitle>
								<CardDescription>
									Current GST work, with older periods available in history.
								</CardDescription>
							</div>
							<div className="flex flex-wrap gap-3">
								<Button
									type="button"
									variant="outline"
									onClick={refreshDashboard}
									disabled={refreshing}
								>
									<RefreshCwIcon data-icon="inline-start" />
									Refresh
								</Button>
							</div>
						</CardHeader>
						<CardContent className="grid gap-4">
							{loading ? (
								<p className="text-sm text-muted-foreground">
									Loading periods…
								</p>
							) : visiblePeriods.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No GST periods available.
								</p>
							) : (
								visiblePeriods.map((period) => (
									<div
										key={`${period.periodStart}-${period.periodEnd}`}
										className="grid gap-4 rounded-2xl border border-border/70 bg-[#fbfaf7] p-4"
									>
										<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
											<div className="flex flex-col gap-2">
												<div className="flex flex-wrap items-center gap-2">
													<Badge variant="secondary">GST</Badge>
													<Badge
														variant={period.filed ? "default" : "outline"}
														className={
															period.filed
																? "bg-emerald-700 text-white"
																: undefined
														}
													>
														{getPeriodStatusLabel(period)}
													</Badge>
												</div>
												<div>
													<p className="text-lg font-semibold">
														{formatPeriodRange(period)}
													</p>
													<p className="text-sm text-muted-foreground">
														Due {formatDate(period.dueDate)}
													</p>
												</div>
											</div>
											<div className="text-left sm:text-right">
												<p className="text-sm text-muted-foreground">
													Estimated refund
												</p>
												<p
													className={`text-xl font-semibold ${getRefundTone(period.totalGstRefund)}`}
												>
													{formatCurrency(period.totalGstRefund)}
												</p>
											</div>
										</div>
										<div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
											<div>
												<p className="font-medium text-foreground">
													{period.expenseCount}
												</p>
												<p>Published expenses</p>
											</div>
											<div>
												<p className="font-medium text-foreground">
													{formatCurrency(period.totalPurchasesAndExpenses)}
												</p>
												<p>Total purchases</p>
											</div>
											<div>
												<p className="font-medium text-foreground">
													{formatCurrency(period.totalGstPaid)}
												</p>
												<p>Total GST paid</p>
											</div>
										</div>
										<div className="flex flex-wrap gap-3">
											<Button
												type="button"
												onClick={() => void loadReturnSummary(period)}
											>
												<ReceiptTextIcon data-icon="inline-start" />
												Open return
											</Button>
											<Button
												type="button"
												variant="outline"
												onClick={() =>
													void togglePeriodFiled(period, !period.filed)
												}
											>
												<CheckCircle2Icon data-icon="inline-start" />
												{period.filed ? "Unmark filed" : "Mark filed"}
											</Button>
										</div>
									</div>
								))
							)}
							{!loading && historyPeriods.length > 0 ? (
								<div className="rounded-2xl border border-border/70 bg-white/70">
									<button
										type="button"
										onClick={() => setHistoryOpen((open) => !open)}
										className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
									>
										<div>
											<p className="font-medium text-foreground">History</p>
											<p className="text-sm text-muted-foreground">
												All previous GST periods from registration start.
											</p>
										</div>
										<ChevronDownIcon
											className={`size-4 shrink-0 text-muted-foreground transition-transform ${
												historyOpen ? "rotate-180" : ""
											}`}
										/>
									</button>
									{historyOpen ? (
										<div className="grid gap-4 border-t border-border/70 p-4">
											{historyPeriods.map((period) => (
												<div
													key={`${period.periodStart}-${period.periodEnd}`}
													className="grid gap-4 rounded-2xl border border-border/70 bg-[#fbfaf7] p-4"
												>
													<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
														<div className="flex flex-col gap-2">
															<div className="flex flex-wrap items-center gap-2">
																<Badge variant="secondary">GST</Badge>
																<Badge
																	variant={period.filed ? "default" : "outline"}
																	className={
																		period.filed
																			? "bg-emerald-700 text-white"
																			: undefined
																	}
																>
																	{getPeriodStatusLabel(period)}
																</Badge>
															</div>
															<div>
																<p className="text-lg font-semibold">
																	{formatPeriodRange(period)}
																</p>
																<p className="text-sm text-muted-foreground">
																	Due {formatDate(period.dueDate)}
																</p>
															</div>
														</div>
														<div className="text-left sm:text-right">
															<p className="text-sm text-muted-foreground">
																Estimated refund
															</p>
															<p
																className={`text-xl font-semibold ${getRefundTone(period.totalGstRefund)}`}
															>
																{formatCurrency(period.totalGstRefund)}
															</p>
														</div>
													</div>
													<div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
														<div>
															<p className="font-medium text-foreground">
																{period.expenseCount}
															</p>
															<p>Published expenses</p>
														</div>
														<div>
															<p className="font-medium text-foreground">
																{formatCurrency(
																	period.totalPurchasesAndExpenses,
																)}
															</p>
															<p>Total purchases</p>
														</div>
														<div>
															<p className="font-medium text-foreground">
																{formatCurrency(period.totalGstPaid)}
															</p>
															<p>Total GST paid</p>
														</div>
													</div>
													<div className="flex flex-wrap gap-3">
														<Button
															type="button"
															onClick={() => void loadReturnSummary(period)}
														>
															<ReceiptTextIcon data-icon="inline-start" />
															Open return
														</Button>
														<Button
															type="button"
															variant="outline"
															onClick={() =>
																void togglePeriodFiled(period, !period.filed)
															}
														>
															<CheckCircle2Icon data-icon="inline-start" />
															{period.filed ? "Unmark filed" : "Mark filed"}
														</Button>
													</div>
												</div>
											))}
										</div>
									) : null}
								</div>
							) : null}
						</CardContent>
					</Card>

					<Card className="border-white/60 bg-white/88 shadow-sm backdrop-blur">
						<CardHeader>
							<CardTitle>Upload invoice files</CardTitle>
							<CardDescription>
								Each file creates one draft expense linked to a temporary asset.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4">
							<Alert>
								<FileUpIcon />
								<AlertTitle>Temporary media assets</AlertTitle>
								<AlertDescription>
									Uploads expire after 24 hours unless the draft expense is
									published and the asset is finalized.
								</AlertDescription>
							</Alert>
							<label
								className={`flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-dashed px-6 py-8 text-center transition-colors ${
									isDragging
										? "border-amber-700 bg-amber-100/70"
										: "border-amber-950/20 bg-[#f8f2e7]"
								}`}
								onDragEnter={() => setIsDragging(true)}
								onDragOver={(event) => {
									event.preventDefault();
									setIsDragging(true);
								}}
								onDragLeave={(event) => {
									if (
										event.currentTarget.contains(event.relatedTarget as Node)
									) {
										return;
									}
									setIsDragging(false);
								}}
								onDrop={(event) => {
									event.preventDefault();
									setIsDragging(false);
									void uploadFiles(event.dataTransfer.files);
								}}
							>
								<div className="flex size-16 items-center justify-center rounded-full bg-[#1e1f1b] text-stone-100">
									<FileUpIcon className="size-7" />
								</div>
								<div className="flex flex-col gap-2">
									<p className="text-lg font-semibold">
										Drop invoices here or choose files
									</p>
									<p className="text-sm text-muted-foreground">
										Supported by the external DAM service through the local SDK
										integration.
									</p>
								</div>
								<div className="flex flex-wrap justify-center gap-3">
									<Button
										type="button"
										variant="secondary"
										disabled={uploading}
										onClick={() => uploadInputRef.current?.click()}
									>
										<FolderOpenIcon data-icon="inline-start" />
										{uploading ? "Uploading…" : "Choose files"}
									</Button>
									<Badge variant="outline">One file = one draft</Badge>
								</div>
								<input
									ref={uploadInputRef}
									className="hidden"
									type="file"
									multiple
									onChange={(event) => {
										if (event.target.files) {
											void uploadFiles(event.target.files);
											event.target.value = "";
										}
									}}
								/>
							</label>
							<Button type="button" onClick={openManualExpenseEditor}>
								<PlusIcon data-icon="inline-start" />
								Add manual expense
							</Button>
						</CardContent>
					</Card>
				</section>

				<section>
					<Card className="border-white/60 bg-white/88 shadow-sm backdrop-blur">
						<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
							<div className="flex flex-col gap-1">
								<CardTitle>Expenses</CardTitle>
								<CardDescription>
									Drafts stay visually distinct and published expenses remain
									editable.
								</CardDescription>
							</div>
							<div className="flex flex-wrap gap-3">
								<Select
									value={sortOrder}
									onValueChange={(value) => setSortOrder(value as SortOrder)}
								>
									<SelectTrigger className="w-[160px]">
										<SelectValue placeholder="Sort order" />
									</SelectTrigger>
									<SelectContent align="end">
										<SelectGroup>
											<SelectItem value="newest">Newest first</SelectItem>
											<SelectItem value="oldest">Oldest first</SelectItem>
										</SelectGroup>
									</SelectContent>
								</Select>
								<Button
									type="button"
									variant="outline"
									onClick={openManualExpenseEditor}
								>
									<PlusIcon data-icon="inline-start" />
									Manual expense
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Date</TableHead>
										<TableHead>Title</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>GST</TableHead>
										<TableHead>GST amount</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>File</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{loading ? (
										<TableRow>
											<TableCell
												colSpan={8}
												className="py-10 text-center text-muted-foreground"
											>
												Loading expenses…
											</TableCell>
										</TableRow>
									) : sortedExpenses.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={8}
												className="py-10 text-center text-muted-foreground"
											>
												No expenses yet. Upload a file or add a manual expense.
											</TableCell>
										</TableRow>
									) : (
										sortedExpenses.map((expense) => (
											<TableRow
												key={expense.id}
												className={
													expense.isDraft
														? "bg-amber-50/60 hover:bg-amber-50"
														: undefined
												}
											>
												<TableCell>
													{expense.expenseDate
														? formatDate(expense.expenseDate)
														: "Draft"}
												</TableCell>
												<TableCell className="max-w-[240px] whitespace-normal">
													<div className="flex flex-col gap-1">
														<span className="font-medium">
															{expense.title || "Untitled upload"}
														</span>
														<span className="text-xs text-muted-foreground">
															Updated {formatDateTime(expense.updatedAt)}
														</span>
													</div>
												</TableCell>
												<TableCell>
													{expense.amount == null
														? "Pending"
														: formatCurrency(expense.amount)}
												</TableCell>
												<TableCell>
													{expense.gstEnabled ? "Yes" : "No"}
												</TableCell>
												<TableCell>
													{formatCurrency(expense.gstAmount)}
												</TableCell>
												<TableCell>
													<Badge
														variant={expense.isDraft ? "outline" : "secondary"}
														className={
															expense.isDraft
																? "border-amber-700 text-amber-900"
																: undefined
														}
													>
														{expense.isDraft ? "Draft" : "Published"}
													</Badge>
												</TableCell>
												<TableCell>
													{expense.assetId ? (
														<Button
															type="button"
															variant="link"
															className="h-auto px-0"
															onClick={() =>
																window.open(
																	`/api/assets/${expense.assetId}/file`,
																	"_blank",
																	"noopener,noreferrer",
																)
															}
														>
															{expense.assetFilename ?? "Open file"}
														</Button>
													) : (
														<span className="text-muted-foreground">
															No file
														</span>
													)}
												</TableCell>
												<TableCell className="text-right">
													<div className="flex justify-end gap-2">
														<Button
															type="button"
															variant="outline"
															size="sm"
															onClick={() => openExpenseEditor(expense)}
														>
															Open
														</Button>
														{expense.isDraft ? (
															<Button
																type="button"
																size="sm"
																onClick={() => void publishExpense(expense.id)}
															>
																Publish
															</Button>
														) : null}
														<Button
															type="button"
															variant="destructive"
															size="sm"
															onClick={() => void deleteExpense(expense.id)}
														>
															Delete
														</Button>
													</div>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</section>
			</div>

			<Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{editor.id ? "Edit expense" : "Add manual expense"}
						</DialogTitle>
						<DialogDescription>
							Publish only when the title, date, and amount are complete.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-5">
						<div className="grid gap-2">
							<Label htmlFor="expense-title">Title</Label>
							<Input
								id="expense-title"
								value={editor.title}
								onChange={(event) =>
									setEditor((current) => ({
										...current,
										title: event.target.value,
									}))
								}
								placeholder="Hetzner server"
							/>
						</div>
						<div className="grid gap-5 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="expense-date">Date</Label>
								<Input
									id="expense-date"
									type="date"
									value={editor.expenseDate}
									onChange={(event) =>
										setEditor((current) => ({
											...current,
											expenseDate: event.target.value,
										}))
									}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="expense-amount">Amount</Label>
								<Input
									id="expense-amount"
									type="number"
									inputMode="decimal"
									min="0"
									step="0.01"
									value={editor.amount}
									onChange={(event) =>
										setEditor((current) => ({
											...current,
											amount: event.target.value,
										}))
									}
									placeholder="115.00"
								/>
							</div>
						</div>
						<div className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/40 px-4 py-3">
							<div className="flex flex-col gap-1">
								<Label htmlFor="gst-enabled">GST enabled</Label>
								<p className="text-sm text-muted-foreground">
									GST is calculated automatically from the GST-inclusive total.
								</p>
							</div>
							<Switch
								id="gst-enabled"
								checked={editor.gstEnabled}
								onCheckedChange={(checked) =>
									setEditor((current) => ({
										...current,
										gstEnabled: checked,
									}))
								}
							/>
						</div>
						<div className="grid gap-4 rounded-2xl border border-border/70 bg-[#fbfaf7] p-4 sm:grid-cols-2">
							<div>
								<p className="text-sm text-muted-foreground">
									Calculated GST amount
								</p>
								<p className="text-xl font-semibold">
									{formatCurrency(liveGstAmount)}
								</p>
							</div>
							<div>
								<p className="text-sm text-muted-foreground">Linked file</p>
								{editor.assetId ? (
									<Button
										type="button"
										variant="link"
										className="h-auto px-0"
										onClick={() =>
											window.open(
												`/api/assets/${editor.assetId}/file`,
												"_blank",
												"noopener,noreferrer",
											)
										}
									>
										{editor.assetFilename ?? "Open file"}
									</Button>
								) : (
									<p className="font-medium text-muted-foreground">
										No file attached
									</p>
								)}
							</div>
							{editor.assetIsTemporary ? (
								<div className="sm:col-span-2">
									<Badge
										variant="outline"
										className="border-amber-700 text-amber-900"
									>
										Temporary asset pending publish
									</Badge>
								</div>
							) : null}
						</div>
					</div>
					<DialogFooter className="gap-2 sm:justify-between">
						<div className="flex flex-wrap gap-2">
							{editor.id ? (
								<Button
									type="button"
									variant="destructive"
									onClick={() => {
										if (editor.id) {
											void deleteExpense(editor.id);
										}
									}}
								>
									<Trash2Icon data-icon="inline-start" />
									Delete
								</Button>
							) : null}
						</div>
						<div className="flex flex-wrap justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsEditorOpen(false)}
							>
								Cancel
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={saving}
								onClick={() => void saveExpense(false)}
							>
								<CircleDashedIcon data-icon="inline-start" />
								Save draft
							</Button>
							{editor.isDraft || editor.id == null ? (
								<Button
									type="button"
									disabled={saving}
									onClick={() => void saveExpense(true)}
								>
									<CheckCircle2Icon data-icon="inline-start" />
									Publish
								</Button>
							) : null}
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>GST return values</DialogTitle>
						<DialogDescription>
							IRD-style values for the selected GST period.
						</DialogDescription>
					</DialogHeader>
					{returnLoading || returnSummary == null ? (
						<div className="py-8 text-sm text-muted-foreground">
							Loading GST return…
						</div>
					) : (
						<div className="grid gap-5">
							<div className="grid gap-3 rounded-2xl border border-border/70 bg-[#fbfaf7] p-4 sm:grid-cols-2">
								<div>
									<p className="text-sm text-muted-foreground">Period</p>
									<p className="font-semibold">
										{formatPeriodRange(returnSummary)}
									</p>
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Due date</p>
									<p className="font-semibold">
										{formatDate(returnSummary.dueDate)}
									</p>
								</div>
								<div>
									<p className="text-sm text-muted-foreground">Status</p>
									<p className="font-semibold">
										{getPeriodStatusLabel(returnSummary)}
									</p>
								</div>
								<div>
									<p className="text-sm text-muted-foreground">
										Published expenses
									</p>
									<p className="font-semibold">{returnSummary.expenseCount}</p>
								</div>
							</div>
							<div className="grid gap-4">
								<h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Sales and income
								</h3>
								<div className="grid gap-3 sm:grid-cols-2">
									<ReturnValueRow
										label="Total GST collected"
										value={returnSummary.totalGstCollected}
										onCopy={() =>
											copyValue(
												"Total GST collected",
												String(returnSummary.totalGstCollected.toFixed(2)),
											)
										}
									/>
									<ReturnValueRow
										label="Zero-rated supplies"
										value={returnSummary.zeroRatedSupplies}
										onCopy={() =>
											copyValue(
												"Zero-rated supplies",
												String(returnSummary.zeroRatedSupplies.toFixed(2)),
											)
										}
									/>
									<ReturnValueRow
										label="Total sales and income"
										value={returnSummary.totalSalesAndIncome}
										onCopy={() =>
											copyValue(
												"Total sales and income",
												String(returnSummary.totalSalesAndIncome.toFixed(2)),
											)
										}
									/>
									<ReturnValueRow
										label="Net GST sales and income"
										value={returnSummary.netGstSalesAndIncome}
										onCopy={() =>
											copyValue(
												"Net GST sales and income",
												String(returnSummary.netGstSalesAndIncome.toFixed(2)),
											)
										}
									/>
								</div>
							</div>
							<div className="grid gap-4">
								<h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									Purchases and expenses
								</h3>
								<div className="grid gap-3 sm:grid-cols-2">
									<ReturnValueRow
										label="Total GST paid"
										value={returnSummary.totalGstPaid}
										onCopy={() =>
											copyValue(
												"Total GST paid",
												String(returnSummary.totalGstPaid.toFixed(2)),
											)
										}
									/>
									<ReturnValueRow
										label="Total purchases and expenses"
										value={returnSummary.totalPurchasesAndExpenses}
										onCopy={() =>
											copyValue(
												"Total purchases and expenses",
												String(
													returnSummary.totalPurchasesAndExpenses.toFixed(2),
												),
											)
										}
									/>
								</div>
							</div>
							<ReturnValueRow
								label="Total GST refund"
								value={roundMoney(returnSummary.totalGstRefund)}
								onCopy={() =>
									copyValue(
										"Total GST refund",
										String(returnSummary.totalGstRefund.toFixed(2)),
									)
								}
							/>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

export default App;
