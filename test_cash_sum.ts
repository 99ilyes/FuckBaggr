import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
const { window } = new JSDOM();
(global as any).DOMParser = window.DOMParser;
(global as any).Element = window.Element;
(global as any).Node = window.Node;

import { TestTransaction } from './src/lib/ibkrParser.ts';

function formatIbkrSymbol(raw: string): string {
    let clean = raw.toUpperCase().replace(" ", "-");
    if (clean === "ASML") return "ASML.AS";
    return clean;
}

function parseNumber(str: string): number {
    if (!str) return 0;
    let s = str.replace(/[\s,]/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function getPreviousText(element: Element | null): string {
    let curr: Node | null = element;
    while (curr) {
        if (curr.previousSibling) {
            curr = curr.previousSibling;
            while (curr.lastChild) {
                curr = curr.lastChild;
            }
            if (curr.nodeType === 3 && curr.textContent && curr.textContent.trim().length > 0) {
                return curr.textContent.trim();
            } else if (curr.textContent && curr.textContent.trim().length > 0) {
                return curr.textContent.trim().split("\n").pop() || "";
            }
        } else {
            curr = curr.parentNode;
        }
    }
    return "";
}

export function parseIBKRCustom(htmlContent: string): { transactions: TestTransaction[], skipped: number } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    const tables = Array.from(doc.querySelectorAll("table"));

    const transactions: TestTransaction[] = [];
    let skipped = 0;

    for (const table of tables) {
        let sectionTitle = getPreviousText(table).toLowerCase();

        const rows = Array.from(table.querySelectorAll("tr"));
        if (rows.length < 2) continue;

        const headerCells = Array.from(rows[0].querySelectorAll("th, td")).map(c => c.textContent?.trim() || "");

        // 1. TRADES AND FOREX
        if (sectionTitle.includes("transactions")) {
            let currentCurrency = "USD";
            for (let i = 1; i < rows.length; i++) {
                const cells = Array.from(rows[i].querySelectorAll("td")).map(c => c.textContent?.trim() || "");

                // Currency header row
                if (cells.length === 1 && cells[0].length === 3) {
                    currentCurrency = cells[0].toUpperCase();
                    continue;
                }

                // Data row
                if (cells.length >= 8 && cells[0] !== "Total") {
                    const symIndex = headerCells.findIndex(h => h.toLowerCase().includes("symbole"));
                    const dateIndex = headerCells.findIndex(h => h.toLowerCase().includes("date/heure"));
                    const qtyIndex = headerCells.findIndex(h => h.toLowerCase().includes("quantité"));
                    const priceIndex = headerCells.findIndex(h => h.toLowerCase().includes("prix trans."));
                    const commIndex = headerCells.findIndex(h => h.toLowerCase().includes("comm/tarif"));
                    const prodIndex = headerCells.findIndex(h => h.toLowerCase().includes("produit"));

                    if (symIndex === -1 || dateIndex === -1 || qtyIndex === -1 || priceIndex === -1) {
                        console.log("SKIPPED: Missing columns", { sectionTitle, headerCells, cells });
                        skipped++; continue;
                    }

                    const rawSym = cells[symIndex];
                    const rawDate = cells[dateIndex].split(",")[0];
                    const qty = parseNumber(cells[qtyIndex]);
                    const price = parseNumber(cells[priceIndex]);
                    const comm = commIndex !== -1 ? parseNumber(cells[commIndex]) : 0;
                    const produit = prodIndex !== -1 ? parseNumber(cells[prodIndex]) : 0;

                    if (!rawSym || qty === 0 || isNaN(qty)) {
                        console.log("SKIPPED: Invalid data", { rawSym, qty, cells });
                        skipped++; continue;
                    }

                    // Forex handling: e.g. EUR.USD
                    if (rawSym.length === 7 && rawSym.includes(".")) {
                        const [baseCur, quoteCur] = rawSym.split(".");

                        if (qty > 0) {
                            transactions.push({ date: rawDate, type: "FOREX", amount: Math.abs(qty), currency: baseCur, exchangeRate: 1 });
                            transactions.push({ date: rawDate, type: "FOREX", amount: -Math.abs(produit), currency: quoteCur, exchangeRate: 1 });
                        } else {
                            transactions.push({ date: rawDate, type: "FOREX", amount: -Math.abs(qty), currency: baseCur, exchangeRate: 1 });
                            transactions.push({ date: rawDate, type: "FOREX", amount: Math.abs(produit), currency: quoteCur, exchangeRate: 1 });
                        }

                        // Handle Commission paid
                        if (comm !== 0) {
                            transactions.push({ date: rawDate, type: "FOREX", amount: -Math.abs(comm), currency: quoteCur, exchangeRate: 1 });
                        }
                        continue;
                    }

                    const type = qty > 0 ? "BUY" : "SELL";
                    const amount = (Math.abs(qty) * price * (type === "BUY" ? -1 : 1)) + comm;

                    transactions.push({
                        date: rawDate,
                        type,
                        symbol: formatIbkrSymbol(rawSym),
                        quantity: Math.abs(qty),
                        price,
                        amount,
                        currency: currentCurrency,
                        exchangeRate: 1
                    });
                }
            }
        }

        // 2. CASH MOVEMENTS
        else if (sectionTitle.includes("dépôts et retraits") || sectionTitle.includes("frais") || sectionTitle.includes("intérêt")) {
            const isInterestSection = sectionTitle.includes("intérêt");
            let currentCurrency = "USD";
            for (let i = 1; i < rows.length; i++) {
                const cells = Array.from(rows[i].querySelectorAll("td")).map(c => c.textContent?.trim() || "");

                if (cells.length === 1 && cells[0].length === 3) {
                    currentCurrency = cells[0].toUpperCase();
                    continue;
                }

                if (cells.length >= 3 && cells[0] !== "Total") {
                    const dateIndex = headerCells.findIndex(h => h.toLowerCase() === "date");
                    const montIndex = headerCells.findIndex(h => h.toLowerCase() === "montant");

                    if (dateIndex === -1 || montIndex === -1) {
                        console.log("SKIPPED: Missing date/montant", { sectionTitle, headerCells, cells });
                        skipped++; continue;
                    }

                    const date = cells[dateIndex];
                    const amount = parseNumber(cells[montIndex]);

                    if (!date || isNaN(amount) || amount === 0) continue;

                    if (isInterestSection) {
                        transactions.push({
                            date,
                            type: "INTEREST",
                            amount,
                            currency: currentCurrency,
                            exchangeRate: 1
                        });
                    } else {
                        transactions.push({
                            date,
                            type: amount > 0 ? "DEPOSIT" : "WITHDRAWAL",
                            amount,
                            currency: currentCurrency,
                            exchangeRate: 1
                        });
                    }
                }
            }
        }

        // 3. DIVIDENDS & WITHHOLDING TAXES
        else if (sectionTitle.includes("dividendes") || sectionTitle.includes("retenues d'impôts")) {
            let currentCurrency = "USD";
            for (let i = 1; i < rows.length; i++) {
                const cells = Array.from(rows[i].querySelectorAll("td")).map(c => c.textContent?.trim() || "");

                if (cells.length === 1 && cells[0].length === 3) {
                    currentCurrency = cells[0].toUpperCase();
                    continue;
                }

                if (cells.length >= 3 && cells[0] !== "Total" && !cells[0].includes("Total")) {
                    const dateIndex = headerCells.findIndex(h => h.toLowerCase() === "date");
                    const descIndex = headerCells.findIndex(h => h.toLowerCase() === "description");
                    const montIndex = headerCells.findIndex(h => h.toLowerCase() === "montant");

                    if (dateIndex === -1 || descIndex === -1 || montIndex === -1) {
                        console.log("SKIPPED: Missing dividend cols", { sectionTitle, headerCells, cells });
                        skipped++; continue;
                    }

                    const date = cells[dateIndex];
                    const amount = parseNumber(cells[montIndex]);

                    if (!date || isNaN(amount) || amount === 0) continue;

                    let symbol = undefined;
                    const symMatch = cells[descIndex].match(/^([A-Z0-9.\-]+)\s*\(/i);
                    if (symMatch && symMatch[1]) {
                        symbol = formatIbkrSymbol(symMatch[1]);
                    }

                    // Taxes are just money taken away, modeled as partial dividend or withdrawal
                    // We model everything from this section as DIVIDEND since it's associated with a stock symbol
                    // If it's withholding tax, amount will be negative, which automatically reduces cash balance just like a withdrawal!
                    transactions.push({
                        date,
                        type: "DIVIDEND",
                        symbol,
                        amount,
                        currency: currentCurrency,
                        exchangeRate: 1
                    });
                }
            }
        }
    }

    transactions.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return 0;
    });

    return { transactions, skipped };
}

const file = process.argv[2] || "U19321556_20250224_20260205.htm";
const htmlContent = readFileSync(file, 'utf-8');
const { transactions, skipped } = parseIBKRCustom(htmlContent);

console.log(`\n============== SKIPPED: ${skipped} =================\n`);

let eurAchat = 0; let eurVente = 0;
let usdAchat = 0; let usdVente = 0;
let eurNet = 0; let usdNet = 0;

for (const tx of transactions) {
    if (tx.currency === "EUR") {
        eurNet += tx.amount;
        if (tx.type === "BUY" || (tx.type === "FOREX" && tx.amount < 0)) eurAchat += tx.amount;
        if (tx.type === "SELL" || (tx.type === "FOREX" && tx.amount > 0)) eurVente += tx.amount;
    } else if (tx.currency === "USD") {
        usdNet += tx.amount;
        if (tx.type === "BUY" || (tx.type === "FOREX" && tx.amount < 0)) usdAchat += tx.amount;
        if (tx.type === "SELL" || (tx.type === "FOREX" && tx.amount > 0)) usdVente += tx.amount;
    }
}

console.log(`GROSS ACHAT EUR: ${eurAchat.toFixed(2)} | IBKR SAYS: -165,007.88`);
console.log(`GROSS VENTE EUR: ${eurVente.toFixed(2)} | IBKR SAYS: 98,440.38`);
console.log(`GROSS ACHAT USD: ${usdAchat.toFixed(2)} | IBKR SAYS: -237,303.88`);
console.log(`GROSS VENTE USD: ${usdVente.toFixed(2)} | IBKR SAYS: 237,313.94`);
console.log(`NET PARSER SUM: EUR = ${eurNet.toFixed(2)}, USD = ${usdNet.toFixed(2)}`);
