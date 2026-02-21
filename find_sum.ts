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

    let netInjected = 0;

    for (const row of rows) {
        const type = String(row["Type"] ?? "").trim();
        const event = String(row["Événement"] ?? "").trim();
        const amount = parseNum(row["Montant comptabilisé"]);

        if (type === "Transfert d'espèces" || type === "Transfert d’espèces") {
            netInjected += amount;
            continue;
        }

        if (type === "Opération") {
            const parsed = extractQtyPrice(event);
            if (!parsed) continue;

            const isTransferIn = event.toLowerCase().includes("transfert entrant");
            const isTransferOut = event.toLowerCase().includes("transfert sortant");

            if (isTransferIn) netInjected += parsed.qty * parsed.price;
            if (isTransferOut) netInjected -= parsed.qty * parsed.price;
        }
    }

    console.log("Net Injected computed from file:", netInjected);
}
main();
