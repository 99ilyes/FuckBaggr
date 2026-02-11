import { Transaction } from "@/hooks/usePortfolios";

interface CSVRow {
    ticker: string;
    type: string;
    quantity: string;
    price: string;
    currency: string;
    transaction_date: string;
}

const TYPE_MAPPING: Record<string, string> = {
    buy: "buy",
    sell: "sell",
    deposit: "deposit",
    withdrawal: "withdrawal"
};

export function parseCSV(content: string, portfolioId: string): Omit<Transaction, "id" | "created_at" | "notes">[] {
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());

    if (!headers.includes("ticker") || !headers.includes("type") || !headers.includes("quantity")) {
        throw new Error("Format CSV invalide. Colonnes requises: ticker;type;quantity;price;currency;transaction_date");
    }

    const transactions: Omit<Transaction, "id" | "created_at" | "notes">[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(";").map((v) => v.trim());
        if (values.length !== headers.length) continue;

        const row: any = {};
        headers.forEach((h, index) => {
            row[h] = values[index];
        });

        const csvRow = row as CSVRow;

        // Parse date DD/MM/YYYY to ISO
        const dateParts = csvRow.transaction_date.split("/");
        const isoDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

        // Handle numeric values (ensure dots for decimals)
        const quantity = parseFloat(csvRow.quantity.replace(",", "."));
        const price = csvRow.price ? parseFloat(csvRow.price.replace(",", ".")) : 0;

        const type = TYPE_MAPPING[csvRow.type.toLowerCase()] || "buy";

        // Skip if invalid
        if (isNaN(quantity) || !dateParts[2]) continue;

        transactions.push({
            portfolio_id: portfolioId,
            date: isoDate,
            type: type,
            ticker: type === 'deposit' || type === 'withdrawal' ? null : csvRow.ticker,
            quantity: quantity,
            unit_price: price,
            fees: 0, // CSV doesn't seem to have fees yet, default to 0
            currency: csvRow.currency || "EUR",
        } as any);
    }

    return transactions;
}
