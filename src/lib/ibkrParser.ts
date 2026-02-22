export interface TestTransaction {
    date: string;
    type: "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL" | "DIVIDEND" | "TRANSFER_IN" | "TRANSFER_OUT" | "FOREX" | "INTEREST";
    symbol?: string;
    quantity?: number;
    price?: number;
    amount: number;
    currency: string;
    cashCurrency?: string;
    exchangeRate: number;
}

const EXCHANGE_MAPPING: Record<string, string> = {
    // Common IBKR symbol to Yahoo mappings can be added here
};

function formatIbkrSymbol(raw: string): string {
    // IBKR usually just uses the ticker, but for EU stocks we might need to append suffixes.
    // For now, let's keep it simple. If it's a known EU stock, we might need a mapping.
    // We'll rely on the user to fix symbols manually if needed, or we do a basic matching.
    let clean = raw.toUpperCase().replace(" ", "-");
    if (clean === "ASML") return "ASML.AS";
    // Add other common ones if needed, or leave as is (for US stocks)
    return clean;
}

function parseNumber(str: string): number {
    if (!str) return 0;
    // The IBKR statement strictly uses '.' for decimals and ',' for thousands,
    // e.g. "49,182", "51,580.61", "1,000.00".
    // We simply remove all spaces and all commas to get the raw parseable string.
    let s = str.replace(/[\s,]/g, "");

    // In the edge case where the user REALLY has a European localized file 
    // that uses NO dots and only commas for decimals (e.g. "50,24" instead of "50.24"),
    // but the file clearly shows "50.24" in the dump.
    // If the string had a comma but NO dot, and it has exactly 2 trailing digits, it MIGHT be decimal.
    // However, given the dump, IBKR uses '.' for decimals universally here.

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

export function parseIBKR(htmlContent: string): { transactions: TestTransaction[], skipped: number } {
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
                        skipped++; continue;
                    }

                    const rawSym = cells[symIndex];
                    const rawDate = cells[dateIndex].split(",")[0];
                    const qty = parseNumber(cells[qtyIndex]);
                    const price = parseNumber(cells[priceIndex]);
                    const comm = commIndex !== -1 ? parseNumber(cells[commIndex]) : 0;
                    const produit = prodIndex !== -1 ? parseNumber(cells[prodIndex]) : 0;

                    if (!rawSym || qty === 0 || isNaN(qty)) { skipped++; continue; }

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
