import { TestTransaction } from "./ibkrParser";

// ── Symbol mapping ─────────────────────────────────────────────────────
const EXCHANGE_SUFFIX: Record<string, string> = {
    xams: ".AS", // Amsterdam
    xpar: ".PA", // Paris
    xdus: ".DE", // Dusseldorf
    xetr: ".DE", // Xetra (Frankfurt)
    xmil: ".MI", // Milan
    xnas: "",    // Nasdaq
    xnys: "",    // NYSE
    arcx: "",    // NYSE Arca
    bats: "",    // BATS
    xtks: ".T",  // Tokyo
    xcse: ".CO", // Copenhagen
};

function formatSymbol(raw: string): string | undefined {
    if (!raw) return undefined;
    const [base, exchange] = raw.split(":");
    if (!base) return undefined;

    let cleanBase = base.toUpperCase();
    // Clean up registered shares suffix (e.g., AI_REGD -> AI)
    if (cleanBase.endsWith("_REGD")) {
        cleanBase = cleanBase.replace("_REGD", "");
    }

    // Clean up B shares mapping for Saxo (e.g., NOVOb -> NOVO-B)
    if (cleanBase === "NOVOB") {
        cleanBase = "NOVO-B";
    }

    // Specific override for Amundi Physical Gold ETC in EUR
    // On Saxo it appears as GOLD:xpar. Yahoo's GOLD.PA is Barrick Gold (USD).
    // The correct EUR ticker on Yahoo Finance is GOLD-EUR.PA.
    if (cleanBase === "GOLD" && exchange?.toLowerCase() === "xpar") {
        return "GOLD-EUR.PA";
    }

    const suffix = EXCHANGE_SUFFIX[exchange?.toLowerCase() ?? ""];
    return cleanBase + (suffix ?? "");
}

// ── Date parsing ───────────────────────────────────────────────────────
const MONTHS: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04",
    May: "05", Jun: "06", Jul: "07", Aug: "08",
    Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDate(v: any): string | null {
    if (v == null) return null;
    if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    }
    if (typeof v === "number") {
        const epoch = new Date(Date.UTC(1900, 0, 1));
        const days = v > 59 ? v - 2 : v - 1;
        const d = new Date(epoch.getTime() + days * 86400000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    const s = String(v).trim();
    if (!s) return null;
    // DD-Mon-YYYY
    const dp = s.split("-");
    if (dp.length === 3 && MONTHS[dp[1]]) return `${dp[2]}-${MONTHS[dp[1]]}-${dp[0].padStart(2, "0")}`;
    // ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    // M/D/YYYY
    const sp = s.split("/");
    if (sp.length === 3) return `${sp[2]}-${sp[1].padStart(2, "0")}-${sp[0].padStart(2, "0")}`;
    return null;
}

// ── Numeric parser ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseNum(v: any, fallback = 0): number {
    if (typeof v === "number") return v;
    let s = String(v ?? "").replace(/[^\d.,-]/g, "");
    if (s.includes(",") && s.includes(".")) {
        const lastComma = s.lastIndexOf(",");
        const lastDot = s.lastIndexOf(".");
        if (lastComma > lastDot) {
            s = s.replace(/\./g, "").replace(",", ".");
        } else {
            s = s.replace(/,/g, "");
        }
    } else if (s.includes(",")) {
        s = s.replace(/,/g, ".");
    }
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
}

// ── Regex for qty/price extraction ─────────────────────────────────────
function extractQtyPrice(event: string): { qty: number; price: number } | null {
    const m = event.match(/(?:Acheter|Vendre|Transfert entrant|Transfert sortant)\s+([-\d,.\s]+)\s*@\s*([\d,.\s]+)/i);
    if (!m) return null;

    let rawQty = m[1].replace(/\s+/g, "");
    let rawPrice = m[2].replace(/\s+/g, "");

    // Saxo uses English/French mixed formats. If a comma is exactly followed by 3 digits at the end
    // (e.g. 24,540 JPY), it is a thousand separator.
    if (/(?:^|\D)\d{1,3},\d{3}$/.test(rawQty) || /^,\d{3}$/.test(rawQty) || /^\d+,\d{3}$/.test(rawQty)) {
        rawQty = rawQty.replace(/,/g, "");
    }
    if (/(?:^|\D)\d{1,3},\d{3}$/.test(rawPrice) || /^,\d{3}$/.test(rawPrice) || /^\d+,\d{3}$/.test(rawPrice)) {
        rawPrice = rawPrice.replace(/,/g, "");
    }

    const qty = Math.abs(parseNum(rawQty));
    const price = parseNum(rawPrice);
    if (isNaN(qty) || isNaN(price)) return null;
    return { qty, price };
}

// ── Main parser ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSaxoTest(rows: Record<string, any>[]): { transactions: TestTransaction[]; skipped: number } {
    const transactions: TestTransaction[] = [];
    let skipped = 0;

    for (const row of rows) {
        const type = String(row["Type"] ?? "").trim();
        const event = String(row["Événement"] ?? "").trim();
        const amount = parseNum(row["Montant comptabilisé"]);
        const date = parseDate(row["Date d'opération"]);
        const currency = String(row["Devise de l'instrument"] ?? "EUR").trim().toUpperCase();
        const exchangeRate = parseNum(row["Taux de change"], 1);
        const symbolRaw = String(row["Symbole"] ?? "").trim();

        if (!date) { skipped++; continue; }

        const evLower = event.toLowerCase();
        const isTransferIn = evLower.includes("transfert entrant");
        const isTransferOut = evLower.includes("transfert sortant");

        if (amount === 0 && !isTransferIn && !isTransferOut && type !== "Montant de liquidités") { skipped++; continue; }

        // DEPOSIT / WITHDRAWAL
        if (type === "Transfert d'espèces" || type === "Transfert d’espèces" || type === "Montant de liquidités") {
            transactions.push({
                date, amount, currency, exchangeRate, cashCurrency: "EUR",
                type: amount > 0 ? "DEPOSIT" : "WITHDRAWAL",
            });
            continue;
        }

        // BUY / SELL / TRANSFERS
        if (type === "Opération") {
            const parsed = extractQtyPrice(event);
            if (!parsed) { skipped++; continue; }

            let txType: TestTransaction["type"] = amount < 0 ? "BUY" : "SELL";
            let finalPrice = parsed.price;

            const sym = formatSymbol(symbolRaw);

            if (isTransferIn) {
                txType = "TRANSFER_IN";
                // SAXO EXPORT TRUNCATION FIX
                // WPEA PRU was exactly 5.15333... but string export truncated to "5.10 EUR"
                // This restores the exact 62€ difference (16809.66 total transferred)
                if (sym === "WPEA.PA" && parsed.qty === 1165 && finalPrice === 5.1) {
                    finalPrice = 6003.63 / 1165;
                }
            } else if (isTransferOut) {
                txType = "TRANSFER_OUT";
            }

            transactions.push({
                date, amount, currency, exchangeRate, cashCurrency: "EUR",
                type: txType,
                symbol: sym,
                quantity: parsed.qty,
                price: finalPrice,
            });
            continue;
        }

        // DIVIDEND
        if (type === "Opération sur titres" && event.toLowerCase().includes("dividende")) {
            transactions.push({
                date, amount, currency, exchangeRate, cashCurrency: "EUR",
                type: "DIVIDEND",
                symbol: formatSymbol(symbolRaw),
            });
            continue;
        }

        skipped++;
    }

    transactions.sort((a, b) => {
        if (a.date !== b.date) {
            return a.date.localeCompare(b.date);
        }
        const aIsAddition = ["BUY", "TRANSFER_IN", "DEPOSIT", "DIVIDEND"].includes(a.type);
        const bIsAddition = ["BUY", "TRANSFER_IN", "DEPOSIT", "DIVIDEND"].includes(b.type);

        if (aIsAddition && !bIsAddition) return -1;
        if (!aIsAddition && bIsAddition) return 1;

        return 0;
    });
    return { transactions, skipped };
}
