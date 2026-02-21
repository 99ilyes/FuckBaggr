import * as XLSX from "xlsx";
import * as fs from "fs";

function parseNum(v: any, fallback = 0): number {
    if (typeof v === "number") return v;
    let s = String(v ?? "").replace(/[^\d.,-]/g, "");
    if (s.includes(",") && s.includes(".")) {
        const lastComma = s.lastIndexOf(",");
        const lastDot = s.lastIndexOf(".");
        if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
        else s = s.replace(/,/g, "");
    } else if (s.includes(",")) s = s.replace(/,/g, ".");
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
}

function extractQtyPrice(event: string): { qty: number; price: number } | null {
    const m = event.match(/(?:Acheter|Vendre|Transfert entrant|Transfert sortant)\s+([-\d,.\s]+)\s*@\s*([\d,.\s]+)/i);
    if (!m) return null;
    const qty = Math.abs(parseNum(m[1]));
    const price = parseNum(m[2]);
    if (isNaN(qty) || isNaN(price)) return null;
    return { qty, price };
}

function main() {
    const wb = XLSX.read(fs.readFileSync("Transactions_19346705_2024-07-31_2026-02-19.xlsx"), { type: "buffer", cellDates: true, raw: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

    const transactions: any[] = [];

    for (const row of rows) {
        const type = String(row["Type"] ?? "").trim();
        const event = String(row["Événement"] ?? "").trim();
        const amount = parseNum(row["Montant comptabilisé"]);
        const evLower = event.toLowerCase();
        const isTransferIn = evLower.includes("transfert entrant");
        const isTransferOut = evLower.includes("transfert sortant");
        const symbolRaw = String(row["Symbole"] ?? "").trim();

        let date = row["Date d'opération"];
        if (date instanceof Date) {
            date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        } else continue;

        if (amount === 0 && !isTransferIn && !isTransferOut) continue;

        if (type === "Opération") {
            const parsed = extractQtyPrice(event);
            if (!parsed) continue;

            let txType = amount < 0 ? "BUY" : "SELL";
            let finalPrice = parsed.price;

            if (isTransferIn) { txType = "TRANSFER_IN"; }
            else if (isTransferOut) { txType = "TRANSFER_OUT"; }

            transactions.push({
                date, type: txType, symbol: symbolRaw,
                quantity: parsed.qty, price: finalPrice, amount
            });
        }
    }

    transactions.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const aIsAddition = ["BUY", "TRANSFER_IN"].includes(a.type);
        const bIsAddition = ["BUY", "TRANSFER_IN"].includes(b.type);
        if (aIsAddition && !bIsAddition) return -1;
        if (!aIsAddition && bIsAddition) return 1;
        return 0;
    });

    const pos = new Map<string, { qty: number; costBasis: number }>();
    for (const tx of transactions) {
        if (!tx.symbol) continue;
        const current = pos.get(tx.symbol) || { qty: 0, costBasis: 0 };
        if (tx.type === "BUY" || tx.type === "TRANSFER_IN") {
            current.qty += tx.quantity;
            current.costBasis += tx.quantity * tx.price; // This computes pure cost
        } else if (tx.type === "SELL" || tx.type === "TRANSFER_OUT") {
            if (current.qty > 0) {
                const ratio = tx.quantity / current.qty;
                current.costBasis -= current.costBasis * ratio;
                current.qty -= tx.quantity;
            }
        }
        pos.set(tx.symbol, current);
    }

    let totalCostBasis = 0;
    for (const [sym, p] of pos.entries()) {
        if (p.qty > 0.001) {
            totalCostBasis += p.costBasis;
            console.log(`${sym}: Qty ${p.qty}, CostBasis ${p.costBasis}`);
        }
    }
    console.log("Total Cost Basis of Open Positions:", totalCostBasis);
}
main();
