import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calculator as CalculatorIcon, Plus, Trash2, Cloud, CloudOff, ChevronDown, ChevronUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { format, addMonths, isSameMonth, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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
    const [payFromCapital, setPayFromCapital] = useState<boolean>(() => getSaved().payFromCapital ?? true);

    // --- Results ---
    // --- Results ---
    const [resultsA, setResultsA] = useState<{ rows: SimulationRow[], summary: any }>({ rows: [], summary: {} });
    const [resultsB, setResultsB] = useState<{ rows: SimulationRow[], summary: any }>({ rows: [], summary: {} });
    const [activeTab, setActiveTab] = useState<"scenarioA" | "scenarioB">("scenarioA");

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
                    if ((data as any).pay_from_capital != null) setPayFromCapital(Boolean((data as any).pay_from_capital));
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
                    pay_from_capital: (settings as any).payFromCapital,
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
                repaymentStartDate, customPayments, repaymentDurationYears, loanInterestRateRepayment, payFromCapital
            });
        }, 1000);
        return () => clearTimeout(timer);
    }, [loanAmount, loanStartDate, insuranceAmount, investmentReturnRate, repaymentStartDate, customPayments, repaymentDurationYears, loanInterestRateRepayment, payFromCapital, saveSettings]);

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
    const calculateSimulation = useCallback(() => {
        // --- Common Phase 1: Deferral (Epargne) ---
        const rowsCommon: SimulationRow[] = [];
        let currentDate = parseISO(loanStartDate);
        currentDate.setDate(1);
        currentDate = addMonths(currentDate, 1);

        let currentCapital = loanAmount;
        let totalInterestEarnedCommon = 0;
        let totalExpensesCommon = 0;
        let totalInsurancePaidCommon = 0;

        const repayStart = parseISO(repaymentStartDate);
        const monthlyInvestRate = Math.pow(1 + investmentReturnRate / 100, 1 / 12) - 1;

        while (currentDate < repayStart) {
            const interest = currentCapital * monthlyInvestRate;
            currentCapital += interest;
            totalInterestEarnedCommon += interest;
            currentCapital -= insuranceAmount;
            totalInsurancePaidCommon += insuranceAmount;

            let monthlyExpenses = 0;
            customPayments.forEach(p => {
                const pDate = parseISO(p.date);
                if (isSameMonth(currentDate, pDate)) {
                    monthlyExpenses += p.amount;
                }
            });
            currentCapital -= monthlyExpenses;
            totalExpensesCommon += monthlyExpenses;

            rowsCommon.push({
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

        // --- Scenario A: Remboursement Anticipé (Existing Logic) ---
        const rowsA = [...rowsCommon];
        let capitalA = currentCapital;
        let totalInterestA = totalInterestEarnedCommon;
        const lumpSumPaid = Math.min(capitalA, loanAmount);
        let debtA = loanAmount - lumpSumPaid;
        capitalA -= lumpSumPaid;

        let monthlyRepaymentA = 0;
        if (debtA > 0 && repaymentDurationYears > 0) {
            const annualRate = loanInterestRateRepayment / 100;
            const monthlyRate = annualRate / 12;
            const numberOfPayments = repaymentDurationYears * 12;
            if (annualRate === 0) monthlyRepaymentA = debtA / numberOfPayments;
            else monthlyRepaymentA = (debtA * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -numberOfPayments));
        }

        let totalLoanInterestA = 0;
        let dateA = new Date(repayStart);
        const repaymentMonths = repaymentDurationYears * 12;

        for (let i = 0; i < repaymentMonths; i++) {
            if (debtA <= 0.1 && capitalA <= 0.1) break;

            if (capitalA > 0) {
                const interest = capitalA * monthlyInvestRate;
                capitalA += interest;
                totalInterestA += interest;
            }

            if (debtA > 0) {
                const monthlyRateLoan = (loanInterestRateRepayment / 100) / 12;
                const interestOnDebt = debtA * monthlyRateLoan;
                totalLoanInterestA += interestOnDebt;
                const principalPayment = monthlyRepaymentA - interestOnDebt;
                debtA -= principalPayment;
                if (debtA < 0) debtA = 0;
            }

            rowsA.push({
                date: new Date(dateA),
                phase: "Remboursement",
                capital: capitalA,
                interestEarned: capitalA > 0 ? capitalA * monthlyInvestRate : 0,
                expenses: 0,
                insurancePaid: 0,
                monthlyRepayment: monthlyRepaymentA,
                remainingDebt: debtA,
                netValue: capitalA - debtA
            });
            dateA = addMonths(dateA, 1);
        }

        setResultsA({
            rows: rowsA,
            summary: {
                totalInterestEarned: totalInterestA,
                totalExpenses: totalExpensesCommon,
                totalInsurancePaid: totalInsurancePaidCommon,
                lumpSumPaid,
                remainingDebtStart: loanAmount - lumpSumPaid,
                monthlyRepaymentAmount: (loanAmount - lumpSumPaid > 0 ? monthlyRepaymentA : 0),
                finalNetValue: rowsA[rowsA.length - 1]?.netValue || 0,
                totalCreditCost: totalLoanInterestA + totalInsurancePaidCommon,
            }
        });

        // --- Scenario B: Capital Conservé (New Logic) ---
        const rowsB = [...rowsCommon];
        let capitalB = currentCapital;
        let totalInterestB = totalInterestEarnedCommon;
        let debtB = loanAmount; // Full loan amount is amortized

        // Calculate standard monthly payment for the full loan
        let monthlyRepaymentB = 0;
        if (repaymentDurationYears > 0) {
            const annualRate = loanInterestRateRepayment / 100;
            const monthlyRate = annualRate / 12;
            const numberOfPayments = repaymentDurationYears * 12;
            if (annualRate === 0) monthlyRepaymentB = debtB / numberOfPayments;
            else monthlyRepaymentB = (debtB * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -numberOfPayments));
        }

        let totalLoanInterestB = 0;
        let dateB = new Date(repayStart);

        for (let i = 0; i < repaymentMonths; i++) {
            // 1. Earn Interest on FULL capital (since we kept it)
            if (capitalB > 0) {
                const interest = capitalB * monthlyInvestRate;
                capitalB += interest;
                totalInterestB += interest;
            }

            // 2. Pay Monthly Installment from Capital (if enabled)
            if (payFromCapital) {
                capitalB -= monthlyRepaymentB;
            }

            // 3. Amortize Debt
            if (debtB > 0) {
                const monthlyRateLoan = (loanInterestRateRepayment / 100) / 12;
                const interestOnDebt = debtB * monthlyRateLoan;
                totalLoanInterestB += interestOnDebt;
                const principalPayment = monthlyRepaymentB - interestOnDebt;
                debtB -= principalPayment;
                if (debtB < 0) debtB = 0;
            }

            rowsB.push({
                date: new Date(dateB),
                phase: "Remboursement",
                capital: capitalB,
                interestEarned: capitalB > 0 ? capitalB * monthlyInvestRate : 0,
                expenses: 0,
                insurancePaid: 0,
                monthlyRepayment: payFromCapital ? monthlyRepaymentB : 0, // Only show as expense from capital if paid from capital
                remainingDebt: debtB,
                netValue: capitalB - debtB
            });
            dateB = addMonths(dateB, 1);
        }

        setResultsB({
            rows: rowsB,
            summary: {
                totalInterestEarned: totalInterestB,
                totalExpenses: totalExpensesCommon,
                totalInsurancePaid: totalInsurancePaidCommon,
                lumpSumPaid: 0, // No lump sum in this scenario
                remainingDebtStart: loanAmount,
                monthlyRepaymentAmount: monthlyRepaymentB, // Always show the required repayment amount in summary
                finalNetValue: rowsB[rowsB.length - 1]?.netValue || 0,
                totalCreditCost: totalLoanInterestB + totalInsurancePaidCommon,
            }
        });
    }, [loanAmount, loanStartDate, insuranceAmount, investmentReturnRate, repaymentStartDate, customPayments, repaymentDurationYears, loanInterestRateRepayment, payFromCapital]);

    useEffect(() => {
        calculateSimulation();
    }, [calculateSimulation]);

    const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

    const SyncIndicator = () => (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {syncStatus === "syncing" && <><Cloud className="w-3.5 h-3.5 animate-pulse text-blue-500" /><span>Synchronisation...</span></>}
            {syncStatus === "synced" && <><Cloud className="w-3.5 h-3.5 text-emerald-500" /><span>Synchronisé</span></>}
            {syncStatus === "error" && <><CloudOff className="w-3.5 h-3.5 text-destructive" /><span>Hors ligne</span></>}
        </div>
    );

    const [isCustomPaymentsOpen, setIsCustomPaymentsOpen] = useState(false);

    return (
        <div className="container mx-auto p-4 md:p-6 space-y-6 animate-in fade-in-50">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
                <div className="flex items-center gap-3">
                    <SidebarTrigger className="-ml-1 md:hidden" />
                    <div className="p-2.5 bg-primary/10 rounded-xl">
                        <CalculatorIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">Calculatrice Crédit</h1>
                        <p className="text-sm text-muted-foreground hidden md:block">
                            Optimisez votre stratégie financière
                        </p>
                    </div>
                </div>
                <SyncIndicator />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                {/* Left Column: Settings (4 cols) - Sticky on Desktop */}
                <div className="xl:col-span-4 space-y-4 xl:sticky xl:top-20">
                    {/* 1. Global Settings */}
                    <Card className="border-border/50 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base font-medium">Paramètres Généraux</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Début Prêt</Label>
                                    <Input type="date" className="h-8 text-sm" value={loanStartDate} onChange={e => setLoanStartDate(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Début Remboursement</Label>
                                    <Input type="date" className="h-8 text-sm" value={repaymentStartDate} onChange={e => setRepaymentStartDate(e.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Montant du Prêt (€)</Label>
                                    <Input
                                        type="number"
                                        value={loanAmount}
                                        onChange={e => setLoanAmount(Number(e.target.value))}
                                        className="h-9"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Rendement Placement (%)</Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        value={investmentReturnRate}
                                        onChange={e => setInvestmentReturnRate(Number(e.target.value))}
                                        className="h-9 text-emerald-600 font-medium"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Assurance Mensuelle (€)</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={insuranceAmount}
                                        onChange={e => setInsuranceAmount(Number(e.target.value))}
                                        className="h-9"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 2. Repayment Settings */}
                    <Card className="border-border/50 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base font-medium">Phase de Remboursement</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Durée (Années)</Label>
                                    <Input
                                        type="number"
                                        value={repaymentDurationYears}
                                        onChange={e => setRepaymentDurationYears(Number(e.target.value))}
                                        className="h-9"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Taux Intérêt Prêt (%)</Label>
                                    <Input
                                        type="number"
                                        step="0.05"
                                        value={loanInterestRateRepayment}
                                        onChange={e => setLoanInterestRateRepayment(Number(e.target.value))}
                                        className="h-9 text-red-600 font-medium"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-2">
                                <Label className="flex flex-col gap-1 cursor-pointer" htmlFor="pay-capital">
                                    <span className="text-sm font-medium">Payer mensualités avec capital ?</span>
                                    <span className="text-xs text-muted-foreground font-normal">
                                        Si désactivé, les mensualités sont payées de votre poche (hors capital).
                                    </span>
                                </Label>
                                <Switch
                                    id="pay-capital"
                                    checked={payFromCapital}
                                    onCheckedChange={setPayFromCapital}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* 3. Custom Payments (Collapsible) */}
                    <Card className="border-border/50 shadow-sm">
                        <Collapsible open={isCustomPaymentsOpen} onOpenChange={setIsCustomPaymentsOpen}>
                            <div className="flex items-center justify-between p-4">
                                <CardTitle className="text-base font-medium">Dépenses Prévues ({customPayments.length})</CardTitle>
                                <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="w-9 p-0">
                                        {isCustomPaymentsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                        <span className="sr-only">Toggle</span>
                                    </Button>
                                </CollapsibleTrigger>
                            </div>
                            <CollapsibleContent>
                                <CardContent className="pt-0 space-y-3">
                                    {customPayments.map((payment) => (
                                        <div key={payment.id} className="grid grid-cols-12 gap-2 items-center border-b pb-2 last:border-0 last:pb-0">
                                            <div className="col-span-5">
                                                <Input
                                                    value={payment.label}
                                                    onChange={e => updatePayment(payment.id, "label", e.target.value)}
                                                    placeholder="Libellé"
                                                    className="h-7 text-xs"
                                                />
                                            </div>
                                            <div className="col-span-4">
                                                <Input
                                                    type="date"
                                                    value={payment.date}
                                                    onChange={e => updatePayment(payment.id, "date", e.target.value)}
                                                    className="h-7 text-xs px-1"
                                                />
                                            </div>
                                            <div className="col-span-3 text-right">
                                                <div className="relative">
                                                    <Input
                                                        type="number"
                                                        value={payment.amount}
                                                        onChange={e => updatePayment(payment.id, "amount", Number(e.target.value))}
                                                        className="h-7 text-xs pr-6 text-right"
                                                    />
                                                    <button onClick={() => removePayment(payment.id)} className="absolute right-1 top-1.5 text-destructive hover:text-destructive/80">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    <Button variant="outline" size="sm" onClick={addPayment} className="w-full mt-2 h-8 text-xs">
                                        <Plus className="w-3.5 h-3.5 mr-1.5" /> Ajouter une dépense
                                    </Button>
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>
                </div>

                {/* Right Column: Results (8 cols) */}
                <div className="xl:col-span-8 space-y-6">
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "scenarioA" | "scenarioB")} className="w-full">
                        <TabsList className="grid w-full grid-cols-2 mb-6">
                            <TabsTrigger value="scenarioA">Remboursement Anticipé</TabsTrigger>
                            <TabsTrigger value="scenarioB">Capital Conservé</TabsTrigger>
                        </TabsList>

                        <div className="space-y-6">
                            {/* Summary Cards */}
                            {/* KPI Dashboard */}
                            <div className="space-y-6">
                                {/* Section 1: Performance */}
                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Performance Financière</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50 shadow-sm">
                                            <CardContent className="pt-6 relative overflow-hidden">
                                                <div className="absolute top-0 right-0 p-3 opacity-10">
                                                    <CalculatorIcon className="w-12 h-12 text-emerald-500" />
                                                </div>
                                                <div className="text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Intérêts Gagnés</div>
                                                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                                                    {fmt(activeTab === "scenarioA" ? resultsA.summary.totalInterestEarned : resultsB.summary.totalInterestEarned)}
                                                </div>
                                            </CardContent>
                                        </Card>

                                        <Card className="bg-purple-50 dark:bg-purple-950/20 border-purple-200/50 shadow-sm">
                                            <CardContent className="pt-6 relative overflow-hidden">
                                                <div className="absolute top-0 right-0 p-3 opacity-10">
                                                    <CalculatorIcon className="w-12 h-12 text-purple-500" />
                                                </div>
                                                <div className="text-xs font-medium uppercase tracking-wider text-purple-600 dark:text-purple-400">Coût Crédit (Intérêts + Ass.)</div>
                                                <div className="text-2xl font-bold text-purple-700 dark:text-purple-300 mt-1">
                                                    {fmt(activeTab === "scenarioA" ? resultsA.summary.totalCreditCost : resultsB.summary.totalCreditCost)}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    <Card className="col-span-1 md:col-span-2 bg-blue-50 dark:bg-blue-950/20 border-blue-200/50 shadow-sm">
                                        <CardContent className="py-6 flex flex-col items-center justify-center text-center">
                                            <div className="text-sm font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">Bénéfice Net (P/L)</div>
                                            <div className={`text-4xl font-bold mt-2 tracking-tight ${(
                                                (activeTab === "scenarioA" ? (resultsA.rows[resultsA.rows.length - 1]?.capital || 0) : (resultsB.rows[resultsB.rows.length - 1]?.capital || 0)) -
                                                (activeTab === "scenarioA"
                                                    ? (resultsA.summary.monthlyRepaymentAmount + insuranceAmount) * repaymentDurationYears * 12
                                                    : (payFromCapital
                                                        ? (insuranceAmount * repaymentDurationYears * 12)
                                                        : (resultsB.summary.monthlyRepaymentAmount + insuranceAmount) * repaymentDurationYears * 12))
                                            ) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                {fmt(
                                                    (activeTab === "scenarioA" ? (resultsA.rows[resultsA.rows.length - 1]?.capital || 0) : (resultsB.rows[resultsB.rows.length - 1]?.capital || 0)) -
                                                    (activeTab === "scenarioA"
                                                        ? (resultsA.summary.monthlyRepaymentAmount + insuranceAmount) * repaymentDurationYears * 12
                                                        : (payFromCapital
                                                            ? (insuranceAmount * repaymentDurationYears * 12)
                                                            : (resultsB.summary.monthlyRepaymentAmount + insuranceAmount) * repaymentDurationYears * 12))
                                                )}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-2 font-medium bg-background/50 px-2 py-1 rounded-full border border-border/10">
                                                Capital Final - Total Sorti de Poche
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>

                                {/* Section 2: Trésorerie */}
                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Trésorerie & Budget</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <Card className="bg-slate-50 dark:bg-slate-900/50 border-slate-200 shadow-sm">
                                            <CardContent className="pt-6">
                                                <div className="text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">Mensualité Prêt</div>
                                                <div className="text-2xl font-bold text-slate-700 dark:text-slate-300 mt-1">
                                                    {fmt(activeTab === "scenarioA" ? resultsA.summary.monthlyRepaymentAmount : resultsB.summary.monthlyRepaymentAmount)}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground mt-1">
                                                    / mois
                                                </div>
                                            </CardContent>
                                        </Card>

                                        <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200/50 shadow-sm">
                                            <CardContent className="pt-6">
                                                <div className="text-xs font-medium uppercase tracking-wider text-orange-600 dark:text-orange-400">Total Dépenses</div>
                                                <div className="text-2xl font-bold text-orange-700 dark:text-orange-300 mt-1">
                                                    {fmt(activeTab === "scenarioA" ? resultsA.summary.totalExpenses : resultsB.summary.totalExpenses)}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground mt-1">
                                                    Sur la période
                                                </div>
                                            </CardContent>
                                        </Card>

                                        <Card className="bg-slate-100 dark:bg-slate-800/50 border-slate-300 dark:border-slate-700 shadow-sm">
                                            <CardContent className="pt-6">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Total Sorti de Poche</div>
                                                </div>
                                                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                                                    {fmt(
                                                        activeTab === "scenarioA"
                                                            ? (resultsA.summary.monthlyRepaymentAmount + insuranceAmount) * repaymentDurationYears * 12
                                                            : (payFromCapital
                                                                ? (insuranceAmount * repaymentDurationYears * 12)
                                                                : (resultsB.summary.monthlyRepaymentAmount + insuranceAmount) * repaymentDurationYears * 12)
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground mt-1 truncate">
                                                    {activeTab === "scenarioB" && payFromCapital && "(Assurance uniquement)"}
                                                    {(!payFromCapital || activeTab === "scenarioA") && "(Mensualités + Ass.)"}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>


                                {/* Section 3: Patrimoine */}
                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Situation Fin de Période</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 shadow-sm">
                                            <CardContent className="pt-6">
                                                <div className="text-xs font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                                    {activeTab === "scenarioA" ? "Capital Disponible pour Remboursement" : "Capital Final Conservé"}
                                                </div>
                                                <div className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1">
                                                    {fmt(activeTab === "scenarioA" ? resultsA.summary.lumpSumPaid : resultsB.rows[resultsB.rows.length - 1]?.capital || 0)}
                                                </div>
                                            </CardContent>
                                        </Card>

                                        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200/50 shadow-sm">
                                            <CardContent className="pt-6">
                                                <div className="text-xs font-medium uppercase tracking-wider text-red-600 dark:text-red-400">Dette Restante (après Opération)</div>
                                                <div className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">
                                                    {fmt(activeTab === "scenarioA" ? resultsA.summary.remainingDebtStart : resultsB.summary.remainingDebtStart)}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </div>

                            {/* Chart */}
                            <Card className="border-border/50 shadow-sm">
                                <CardHeader>
                                    <CardTitle>Projection du Capital vs Dette</CardTitle>
                                </CardHeader>
                                <CardContent className="h-[300px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart
                                            data={(activeTab === "scenarioA" ? resultsA.rows : resultsB.rows).filter((_, i) => i % 6 === 0)} // Sample data to reduce density
                                            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                                        >
                                            <defs>
                                                <linearGradient id="colorCapital" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="colorDebt" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                            <XAxis
                                                dataKey="date"
                                                tickFormatter={(date) => format(date, "yyyy")}
                                                minTickGap={30}
                                                tick={{ fontSize: 12, fill: '#6B7280' }}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                            <YAxis
                                                tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                                                tick={{ fontSize: 12, fill: '#6B7280' }}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                            <Tooltip
                                                labelFormatter={(label) => format(label, "MMMM yyyy", { locale: fr })}
                                                formatter={(value: number) => [fmt(value), ""]}
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                            />
                                            <Legend verticalAlign="top" height={36} />
                                            <Area type="monotone" dataKey="capital" name="Capital Investi" stroke="#10b981" fillOpacity={1} fill="url(#colorCapital)" strokeWidth={2} />
                                            <Area type="monotone" dataKey="remainingDebt" name="Dette Restante" stroke="#ef4444" fillOpacity={1} fill="url(#colorDebt)" strokeWidth={2} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>

                            {/* Timeline Table */}
                            <Card className="h-[500px] flex flex-col border-border/50 shadow-sm">
                                <div className="flex-1 overflow-auto">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-background z-10 border-b">
                                            <TableRow className="hover:bg-transparent">
                                                <TableHead className="w-[100px]">Date</TableHead>
                                                <TableHead>Phase</TableHead>
                                                <TableHead className="text-right">Capital</TableHead>
                                                <TableHead className="text-right text-green-600">Intérêts</TableHead>
                                                <TableHead className="text-right text-red-600">Dépenses</TableHead>
                                                <TableHead className="text-right text-orange-600">
                                                    {activeTab === "scenarioA" ? "Remboursement" : "Mensualité"}
                                                </TableHead>
                                                <TableHead className="text-right">Dette</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {(activeTab === "scenarioA" ? resultsA.rows : resultsB.rows).map((row, index) => (
                                                <TableRow key={index} className={row.phase === "Remboursement" ? "bg-muted/30 hover:bg-muted/50" : "hover:bg-muted/30"}>
                                                    <TableCell className="font-medium whitespace-nowrap text-xs text-muted-foreground">
                                                        {format(row.date, "MMM yyyy", { locale: fr })}
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide border ${row.phase === "Epargne"
                                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                                            : "bg-blue-50 text-blue-700 border-blue-200"
                                                            }`}>
                                                            {row.phase}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium">{fmt(row.capital)}</TableCell>
                                                    <TableCell className="text-right text-emerald-600 text-xs">
                                                        {row.interestEarned > 0 ? `+${row.interestEarned.toFixed(0)}` : "-"}
                                                    </TableCell>
                                                    <TableCell className="text-right text-red-600 text-xs">
                                                        {(row.expenses + row.insurancePaid) > 0
                                                            ? `-${(row.expenses + row.insurancePaid).toFixed(0)}`
                                                            : "-"}
                                                    </TableCell>
                                                    <TableCell className="text-right text-orange-600 font-medium text-xs">
                                                        {row.monthlyRepayment > 0 ? `-${row.monthlyRepayment.toFixed(0)}` : "-"}
                                                    </TableCell>
                                                    <TableCell className="text-right text-muted-foreground text-xs">
                                                        {fmt(row.remainingDebt)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </Card>
                        </div>
                    </Tabs>
                </div>
            </div >
        </div >
    );
};

export default Calculator;
