import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Calculator as CalculatorIcon, Plus, Trash2, Cloud, CloudOff } from "lucide-react";
import { format, addMonths, isSameMonth, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface CustomPayment {
    id: string;
    date: string;
    amount: number;
    label: string;
}

interface SimulationRow {
    date: Date;
    phase: "Epargne" | "Remboursement";
    capital: number;
    interestEarned: number;
    expenses: number;
    insurancePaid: number;
    monthlyRepayment: number;
    remainingDebt: number;
    netValue: number;
}

const STORAGE_KEY = "calculatrice-credit-data";
const SETTINGS_ID = "default";

const getSaved = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
};

const DEFAULT_PAYMENTS: CustomPayment[] = [
    { id: "1", date: "2026-09-01", amount: 5000, label: "Scolarité A1" },
    { id: "2", date: "2027-09-01", amount: 5000, label: "Scolarité A2" },
];

const Calculator = () => {
    const { toast } = useToast();
    const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");

    // --- Inputs (initialized from localStorage for instant load) ---
    const [loanAmount, setLoanAmount] = useState<number>(() => getSaved().loanAmount ?? 20000);
    const [loanStartDate, setLoanStartDate] = useState<string>(() => getSaved().loanStartDate ?? format(new Date(), "yyyy-MM-dd"));
    const [insuranceAmount, setInsuranceAmount] = useState<number>(() => getSaved().insuranceAmount ?? 4.26);
    const [investmentReturnRate, setInvestmentReturnRate] = useState<number>(() => getSaved().investmentReturnRate ?? 5.0);
    const [repaymentStartDate, setRepaymentStartDate] = useState<string>(() => getSaved().repaymentStartDate ?? "2028-10-28");
    const [customPayments, setCustomPayments] = useState<CustomPayment[]>(() => getSaved().customPayments ?? DEFAULT_PAYMENTS);
    const [repaymentDurationYears, setRepaymentDurationYears] = useState<number>(() => getSaved().repaymentDurationYears ?? 5);
    const [loanInterestRateRepayment, setLoanInterestRateRepayment] = useState<number>(() => getSaved().loanInterestRateRepayment ?? 1.0);

    // --- Results ---
    const [simulation, setSimulation] = useState<SimulationRow[]>([]);
    const [summary, setSummary] = useState({
        totalInterestEarned: 0,
        totalExpenses: 0,
        totalInsurancePaid: 0,
        lumpSumPaid: 0,
        monthlyRepaymentAmount: 0,
        finalNetValue: 0,
    });

    // --- Load from cloud on mount ---
    useEffect(() => {
        const loadFromCloud = async () => {
            setSyncStatus("syncing");
            try {
                const { data, error } = await supabase
                    .from("calculator_settings")
                    .select("*")
                    .eq("id", SETTINGS_ID)
                    .maybeSingle();

                if (error) throw error;

                if (data) {
                    if (data.loan_amount != null) setLoanAmount(Number(data.loan_amount));
                    if (data.loan_start_date) setLoanStartDate(data.loan_start_date);
                    if (data.insurance_amount != null) setInsuranceAmount(Number(data.insurance_amount));
                    if (data.investment_return_rate != null) setInvestmentReturnRate(Number(data.investment_return_rate));
                    if (data.repayment_start_date) setRepaymentStartDate(data.repayment_start_date);
                    if (data.custom_payments) setCustomPayments(data.custom_payments as unknown as CustomPayment[]);
                    if (data.repayment_duration_years != null) setRepaymentDurationYears(Number(data.repayment_duration_years));
                    if (data.loan_interest_rate_repayment != null) setLoanInterestRateRepayment(Number(data.loan_interest_rate_repayment));
                }
                setSyncStatus("synced");
            } catch {
                setSyncStatus("error");
            }
        };
        loadFromCloud();
    }, []);

    // --- Save to cloud + localStorage (debounced) ---
    const saveSettings = useCallback(async (settings: object) => {
        // Always save to localStorage immediately
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }

        // Save to cloud
        setSyncStatus("syncing");
        try {
            const { error } = await supabase
                .from("calculator_settings")
                .upsert({
                    id: SETTINGS_ID,
                    loan_amount: (settings as any).loanAmount,
                    loan_start_date: (settings as any).loanStartDate,
                    insurance_amount: (settings as any).insuranceAmount,
                    investment_return_rate: (settings as any).investmentReturnRate,
                    repayment_start_date: (settings as any).repaymentStartDate,
                    custom_payments: (settings as any).customPayments,
                    repayment_duration_years: (settings as any).repaymentDurationYears,
                    loan_interest_rate_repayment: (settings as any).loanInterestRateRepayment,
                    updated_at: new Date().toISOString(),
                }, { onConflict: "id" });

            if (error) throw error;
            setSyncStatus("synced");
        } catch {
            setSyncStatus("error");
        }
    }, []);

    // Debounce saves (wait 1s after last change)
    useEffect(() => {
        const timer = setTimeout(() => {
            saveSettings({
                loanAmount, loanStartDate, insuranceAmount, investmentReturnRate,
                repaymentStartDate, customPayments, repaymentDurationYears, loanInterestRateRepayment,
            });
        }, 1000);
        return () => clearTimeout(timer);
    }, [loanAmount, loanStartDate, insuranceAmount, investmentReturnRate, repaymentStartDate, customPayments, repaymentDurationYears, loanInterestRateRepayment, saveSettings]);

    // --- Helpers ---
    const addPayment = () => {
        setCustomPayments([
            ...customPayments,
            { id: Math.random().toString(36).substr(2, 9), date: format(new Date(), "yyyy-MM-dd"), amount: 0, label: "Nouveau paiement" }
        ]);
    };

    const removePayment = (id: string) => {
        setCustomPayments(customPayments.filter(p => p.id !== id));
    };

    const updatePayment = (id: string, field: keyof CustomPayment, value: any) => {
        setCustomPayments(customPayments.map(p => p.id === id ? { ...p, [field]: value } : p));
    };

    // --- Calculation Logic ---
    const calculateSimulation = () => {
        const rows: SimulationRow[] = [];
        let currentDate = parseISO(loanStartDate);
        currentDate.setDate(1);
        currentDate = addMonths(currentDate, 1);

        let currentCapital = loanAmount;
        let totalInterestEarned = 0;
        let totalExpenses = 0;
        let totalInsurancePaid = 0;

        const repayStart = parseISO(repaymentStartDate);
        const monthlyInvestRate = Math.pow(1 + investmentReturnRate / 100, 1 / 12) - 1;

        while (currentDate < repayStart) {
            const interest = currentCapital * monthlyInvestRate;
            currentCapital += interest;
            totalInterestEarned += interest;
            currentCapital -= insuranceAmount;
            totalInsurancePaid += insuranceAmount;

            let monthlyExpenses = 0;
            customPayments.forEach(p => {
                const pDate = parseISO(p.date);
                if (isSameMonth(currentDate, pDate)) {
                    monthlyExpenses += p.amount;
                }
            });
            currentCapital -= monthlyExpenses;
            totalExpenses += monthlyExpenses;

            rows.push({
                date: new Date(currentDate),
                phase: "Epargne",
                capital: currentCapital,
                interestEarned: interest,
                expenses: monthlyExpenses,
                insurancePaid: insuranceAmount,
                monthlyRepayment: 0,
                remainingDebt: loanAmount,
                netValue: currentCapital - loanAmount
            });

            currentDate = addMonths(currentDate, 1);
        }

        const lumpSumPaid = Math.min(currentCapital, loanAmount);
        let remainingDebtToAmortize = loanAmount - lumpSumPaid;
        let capitalAfterLumpSum = currentCapital - lumpSumPaid;

        let monthlyRepaymentAmount = 0;
        if (remainingDebtToAmortize > 0 && repaymentDurationYears > 0) {
            const annualRate = loanInterestRateRepayment / 100;
            const monthlyRate = annualRate / 12;
            const numberOfPayments = repaymentDurationYears * 12;
            if (annualRate === 0) {
                monthlyRepaymentAmount = remainingDebtToAmortize / numberOfPayments;
            } else {
                monthlyRepaymentAmount = (remainingDebtToAmortize * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -numberOfPayments));
            }
        }

        currentDate = new Date(repayStart);
        let currentDebt = remainingDebtToAmortize;
        const repaymentMonths = repaymentDurationYears * 12;

        for (let i = 0; i < repaymentMonths; i++) {
            if (currentDebt <= 0.1 && capitalAfterLumpSum <= 0.1) break;

            if (capitalAfterLumpSum > 0) {
                const interest = capitalAfterLumpSum * monthlyInvestRate;
                capitalAfterLumpSum += interest;
                totalInterestEarned += interest;
            }

            let interestOnDebt = 0;
            let principalPayment = 0;

            if (currentDebt > 0) {
                const monthlyRateLoan = (loanInterestRateRepayment / 100) / 12;
                interestOnDebt = currentDebt * monthlyRateLoan;
                principalPayment = monthlyRepaymentAmount - interestOnDebt;
                currentDebt -= principalPayment;
                if (currentDebt < 0) currentDebt = 0;
            }

            rows.push({
                date: new Date(currentDate),
                phase: "Remboursement",
                capital: capitalAfterLumpSum,
                interestEarned: (capitalAfterLumpSum > 0 ? capitalAfterLumpSum * monthlyInvestRate : 0),
                expenses: 0,
                insurancePaid: 0,
                monthlyRepayment: monthlyRepaymentAmount,
                remainingDebt: currentDebt,
                netValue: capitalAfterLumpSum - currentDebt
            });

            currentDate = addMonths(currentDate, 1);
        }

        setSimulation(rows);
        setSummary({
            totalInterestEarned,
            totalExpenses,
            totalInsurancePaid,
            lumpSumPaid,
            monthlyRepaymentAmount: (remainingDebtToAmortize > 0 ? monthlyRepaymentAmount : 0),
            finalNetValue: rows[rows.length - 1]?.netValue || 0,
        });
    };

    useEffect(() => {
        calculateSimulation();
    }, [loanAmount, insuranceAmount, investmentReturnRate, repaymentStartDate, customPayments, repaymentDurationYears, loanInterestRateRepayment, loanStartDate]);

    const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

    const SyncIndicator = () => (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {syncStatus === "syncing" && <><Cloud className="w-3.5 h-3.5 animate-pulse text-blue-500" /><span>Synchronisation...</span></>}
            {syncStatus === "synced" && <><Cloud className="w-3.5 h-3.5 text-emerald-500" /><span>Synchronisé</span></>}
            {syncStatus === "error" && <><CloudOff className="w-3.5 h-3.5 text-destructive" /><span>Hors ligne</span></>}
        </div>
    );

    return (
        <div className="container mx-auto p-6 space-y-6 animate-in fade-in-50">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-full">
                        <CalculatorIcon className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Calculatrice Crédit</h1>
                        <p className="text-muted-foreground">
                            Simulez l'investissement de votre prêt, vos dépenses, et le plan de remboursement final.
                        </p>
                    </div>
                </div>
                <SyncIndicator />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Settings (4 cols) */}
                <div className="lg:col-span-4 space-y-6">
                    {/* 1. Loan Initial Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">1. Prêt & Placement (Phase Épargne)</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Date Début Prêt</Label>
                                <Input type="date" value={loanStartDate} onChange={e => setLoanStartDate(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Montant du Prêt (€)</Label>
                                <Input type="number" value={loanAmount} onChange={e => setLoanAmount(Number(e.target.value))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Rendement Placement Annuel (%)</Label>
                                <Input type="number" step="0.1" value={investmentReturnRate} onChange={e => setInvestmentReturnRate(Number(e.target.value))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Assurance Mensuelle (€)</Label>
                                <Input type="number" value={insuranceAmount} onChange={e => setInsuranceAmount(Number(e.target.value))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Date Début Remboursement</Label>
                                <Input type="date" value={repaymentStartDate} onChange={e => setRepaymentStartDate(e.target.value)} />
                            </div>
                        </CardContent>
                    </Card>

                    {/* 2. Custom Payments */}
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle className="text-lg">2. Dépenses Prévues</CardTitle>
                            <Button variant="outline" size="sm" onClick={addPayment}><Plus className="w-4 h-4 mr-2" /> Ajouter</Button>
                        </CardHeader>
                        <CardContent className="space-y-4 max-h-[300px] overflow-y-auto">
                            {customPayments.map((payment) => (
                                <div key={payment.id} className="flex gap-2 items-end border-b pb-2">
                                    <div className="flex-1 space-y-1">
                                        <Input
                                            value={payment.label}
                                            onChange={e => updatePayment(payment.id, "label", e.target.value)}
                                            placeholder="Libellé"
                                            className="h-8 text-sm"
                                        />
                                        <div className="flex gap-2">
                                            <Input
                                                type="date"
                                                value={payment.date}
                                                onChange={e => updatePayment(payment.id, "date", e.target.value)}
                                                className="h-8 text-sm w-32"
                                            />
                                            <Input
                                                type="number"
                                                value={payment.amount}
                                                onChange={e => updatePayment(payment.id, "amount", Number(e.target.value))}
                                                className="h-8 text-sm flex-1"
                                                placeholder="€"
                                            />
                                        </div>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removePayment(payment.id)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>

                    {/* 3. Repayment Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">3. Remboursement (Phase 2)</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Durée Remboursement (Années)</Label>
                                <Input type="number" value={repaymentDurationYears} onChange={e => setRepaymentDurationYears(Number(e.target.value))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Taux Intêt Prêt (Phase Remboursement %)</Label>
                                <Input type="number" step="0.1" value={loanInterestRateRepayment} onChange={e => setLoanInterestRateRepayment(Number(e.target.value))} />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Results (8 cols) */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50">
                            <CardContent className="pt-6">
                                <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Total Intérêts Gagnés</div>
                                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{fmt(summary.totalInterestEarned)}</div>
                            </CardContent>
                        </Card>
                        <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200/50">
                            <CardContent className="pt-6">
                                <div className="text-sm font-medium text-amber-600 dark:text-amber-400">Remboursement Anticipé</div>
                                <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{fmt(summary.lumpSumPaid)}</div>
                            </CardContent>
                        </Card>
                        <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200/50">
                            <CardContent className="pt-6">
                                <div className="text-sm font-medium text-blue-600 dark:text-blue-400">Mensualité Future</div>
                                <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{fmt(summary.monthlyRepaymentAmount)}</div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Timeline Table */}
                    <Card className="h-[600px] flex flex-col">
                        <CardHeader>
                            <CardTitle>Échéancier Détaillé</CardTitle>
                        </CardHeader>
                        <div className="flex-1 overflow-auto">
                            <Table>
                                <TableHeader className="sticky top-0 bg-background z-10">
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Phase</TableHead>
                                        <TableHead>Capital Dispo.</TableHead>
                                        <TableHead className="text-green-600">Intérêts (+)</TableHead>
                                        <TableHead className="text-red-600">Dépenses (-)</TableHead>
                                        <TableHead className="text-orange-600">Remboursement (-)</TableHead>
                                        <TableHead>Dette Restante</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {simulation.map((row, index) => (
                                        <TableRow key={index} className={row.phase === "Remboursement" ? "bg-muted/30" : ""}>
                                            <TableCell className="font-medium whitespace-nowrap">
                                                {format(row.date, "MMM yyyy", { locale: fr })}
                                            </TableCell>
                                            <TableCell>
                                                <span className={`px-2 py-1 rounded-full text-xs ${row.phase === "Epargne"
                                                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                                                    : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                                                    }`}>
                                                    {row.phase}
                                                </span>
                                            </TableCell>
                                            <TableCell>{fmt(row.capital)}</TableCell>
                                            <TableCell className="text-green-600 text-xs">
                                                {row.interestEarned > 0 ? `+${row.interestEarned.toFixed(2)}` : "-"}
                                            </TableCell>
                                            <TableCell className="text-red-600 text-xs">
                                                {(row.expenses + row.insurancePaid) > 0
                                                    ? `-${(row.expenses + row.insurancePaid).toFixed(2)}`
                                                    : "-"}
                                            </TableCell>
                                            <TableCell className="text-orange-600 font-medium">
                                                {row.monthlyRepayment > 0 ? `-${row.monthlyRepayment.toFixed(2)}` : "-"}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {fmt(row.remainingDebt)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default Calculator;
