import * as fs from "fs";

let content = fs.readFileSync("src/pages/TestImport.tsx", "utf-8");

// 1. Add FOREX to TestTransaction
content = content.replace(
  /type: "DEPOSIT" \| "WITHDRAWAL" \| "BUY" \| "SELL" \| "DIVIDEND" \| "TRANSFER_IN" \| "TRANSFER_OUT";/,
  'type: "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL" | "DIVIDEND" | "TRANSFER_IN" | "TRANSFER_OUT" | "FOREX";'
);

// 2. Add FOREX to TYPE_STYLE
content = content.replace(
  /TRANSFER_OUT: "bg-pink-600 text-white hover:bg-pink-600",/,
  'TRANSFER_OUT: "bg-pink-600 text-white hover:bg-pink-600",\n  FOREX: "bg-indigo-600 text-white hover:bg-indigo-600",'
);

// 3. Update reconstructDailyPortfolioAndTWR
let TWR_TARGET = `
  let cashBalance = 0;
  const positions = new Map<string, number>(); // symbol -> quantity
  let cumulativeTwr = 0; // 0 means 0%
  let lastNav = 0;

  const result: DailyPoint[] = [];

  for (const day of days) {
    let dayNetCashFlow = 0;

    // 1. Process Day's Transactions
    const dayTxs = txByDate.get(day) || [];
    for (const tx of dayTxs) {
      if (tx.currency && tx.exchangeRate) {
        latestFx.set(tx.currency, tx.exchangeRate);
      }

      if (tx.type === "DEPOSIT") {
        cashBalance += tx.amount;
        dayNetCashFlow += tx.amount;
      } else if (tx.type === "WITHDRAWAL") {
        cashBalance += tx.amount;
        dayNetCashFlow += tx.amount; // amount is negative
      } else if (tx.type === "DIVIDEND") {
        cashBalance += tx.amount;
      } else if (tx.type === "BUY") {
        cashBalance += tx.amount; // amount is negative
        if (tx.symbol && tx.quantity) {
          positions.set(tx.symbol, (positions.get(tx.symbol) || 0) + tx.quantity);
        }
      } else if (tx.type === "SELL") {
        cashBalance += tx.amount; // amount is positive
        if (tx.symbol && tx.quantity) {
          positions.set(tx.symbol, (positions.get(tx.symbol) || 0) - tx.quantity);
        }
      } else if (tx.type === "TRANSFER_IN") {`;

let TWR_REPLACEMENT = `
  const cashByCurrency = new Map<string, number>();
  const positions = new Map<string, number>(); // symbol -> quantity
  let cumulativeTwr = 0; // 0 means 0%
  let lastNav = 0;

  const result: DailyPoint[] = [];

  for (const day of days) {
    let dayNetCashFlow = 0;

    // Helper to calculate EUR value for a cash transaction
    const getEurValueForTx = (txAmount: number, txCurrency: string, targetDay: string) => {
      if (txCurrency === "EUR") return txAmount;
      let fx = latestFx.get(txCurrency) || 1;
      if (fx === 1) {
        const hFx = getPriceForDay(histories[\`\${txCurrency}EUR=X\`], targetDay);
        if (hFx > 0) fx = hFx;
      }
      return fx !== 1 ? txAmount * fx : txAmount;
    };

    // 1. Process Day's Transactions
    const dayTxs = txByDate.get(day) || [];
    for (const tx of dayTxs) {
      if (tx.currency && tx.exchangeRate) {
        latestFx.set(tx.currency, tx.exchangeRate);
      }

      if (tx.type === "DEPOSIT") {
        cashByCurrency.set(tx.currency, (cashByCurrency.get(tx.currency) || 0) + tx.amount);
        dayNetCashFlow += getEurValueForTx(tx.amount, tx.currency, day);
      } else if (tx.type === "WITHDRAWAL") {
        cashByCurrency.set(tx.currency, (cashByCurrency.get(tx.currency) || 0) + tx.amount);
        dayNetCashFlow += getEurValueForTx(tx.amount, tx.currency, day);
      } else if (tx.type === "FOREX") {
        cashByCurrency.set(tx.currency, (cashByCurrency.get(tx.currency) || 0) + tx.amount);
        // FOREX does not affect TWR net cash flows since it's an internal exchange
      } else if (tx.type === "DIVIDEND") {
        cashByCurrency.set(tx.currency, (cashByCurrency.get(tx.currency) || 0) + tx.amount);
      } else if (tx.type === "BUY") {
        cashByCurrency.set(tx.currency, (cashByCurrency.get(tx.currency) || 0) + tx.amount);
        if (tx.symbol && tx.quantity) {
          positions.set(tx.symbol, (positions.get(tx.symbol) || 0) + tx.quantity);
        }
      } else if (tx.type === "SELL") {
        cashByCurrency.set(tx.currency, (cashByCurrency.get(tx.currency) || 0) + tx.amount);
        if (tx.symbol && tx.quantity) {
          positions.set(tx.symbol, (positions.get(tx.symbol) || 0) - tx.quantity);
        }
      } else if (tx.type === "TRANSFER_IN") {`;

// Replace using a simple strings method if content has it.
content = content.split("let cashBalance = 0;").join("/*SPLIT*/ let cashBalance = 0;");
if (content.includes("/*SPLIT*/ let cashBalance = 0;") && content.includes(`else if (tx.type === "TRANSFER_IN") {`)) {
  const parts = content.split("/*SPLIT*/ let cashBalance = 0;");
  // Find the end index of the targeted replacement in parts[1]
  const endMarker = `} else if (tx.type === "TRANSFER_IN") {`;
  const split2 = parts[1].split(endMarker);
  
  if (split2.length >= 2) {
    content = parts[0] + TWR_REPLACEMENT + split2.slice(1).join(endMarker);
  } else {
    console.error("Marker 1 failed.");
  }
}

// 4. Update TWR NAV calc
let NAV_TARGET = `
    // 2. Calculate End-of-Day NAV
    let nav = cashBalance;
    for (const [symbol, qty] of positions.entries()) {`;

let NAV_REPLACEMENT = `
    // 2. Calculate End-of-Day NAV
    let nav = 0;
    for (const [cur, amount] of cashByCurrency.entries()) {
      let fx = latestFx.get(cur) || 1;
      if (cur !== "EUR" && fx === 1) {
        const hFx = getPriceForDay(histories[\`\${cur}EUR=X\`], day);
        if (hFx > 0) fx = hFx;
      }
      nav += amount * (cur !== "EUR" ? fx : 1);
    }

    for (const [symbol, qty] of positions.entries()) {`;

if (content.includes(`let nav = cashBalance;`)) {
  content = content.replace(NAV_TARGET, NAV_REPLACEMENT);
} else {
  console.error("Marker 2 failed.");
}

// 5. Update computeKPIs
let KPI_TARGET = `
  let cash = 0;
  let realizedPl = 0;
  let netInjected = 0;
  const pos = new Map<string, { quantity: number; eurCostBasis: number }>();
  const latestFx = new Map<string, number>();

  // 1. Process all transactions to track Cash, Realized P/L, and Cost Basis
  for (const tx of transactions) {
    if (tx.currency && tx.exchangeRate) {
      latestFx.set(tx.currency, tx.exchangeRate);
    }
    if (["DEPOSIT", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND"].includes(tx.type)) {
      cash += tx.amount;
    }

    if (["DEPOSIT", "WITHDRAWAL"].includes(tx.type)) {
      netInjected += tx.amount;
    }`;

let KPI_REPLACEMENT = `
  const cashByCurrency = new Map<string, number>();
  let realizedPl = 0;
  let netInjected = 0; // in EUR
  const pos = new Map<string, { quantity: number; eurCostBasis: number }>();
  const latestFx = new Map<string, number>();

  const todayStr = new Date().toISOString().split("T")[0];

  const getEurValue = (txAmount: number, txCurrency: string) => {
     if (txCurrency === "EUR") return txAmount;
     let fx = latestFx.get(txCurrency) || 1;
     // Fallback to history for accurately pricing injections if exchange rate is missing
     if (fx === 1) {
        const hFx = getPriceForDay(histories[\`\${txCurrency}EUR=X\`], todayStr);
        if (hFx > 0) fx = hFx;
     }
     return fx !== 1 ? txAmount * fx : txAmount;
  };

  // 1. Process all transactions to track Cash, Realized P/L, and Cost Basis
  for (const tx of transactions) {
    if (tx.currency && tx.exchangeRate) {
      latestFx.set(tx.currency, tx.exchangeRate);
    }
    if (["DEPOSIT", "WITHDRAWAL", "BUY", "SELL", "DIVIDEND", "FOREX"].includes(tx.type)) {
      cashByCurrency.set(tx.currency, (cashByCurrency.get(tx.currency) || 0) + tx.amount);
    }

    if (["DEPOSIT", "WITHDRAWAL"].includes(tx.type)) {
      netInjected += getEurValue(tx.amount, tx.currency);
    }`;

if (content.includes(`let cash = 0;`)) {
  const parts = content.split("let cash = 0;\n  let realizedPl = 0;");
  const endMarker = `    if (["DEPOSIT", "WITHDRAWAL"].includes(tx.type)) {\n      netInjected += tx.amount;\n    }`;
  
  if (parts.length > 1) {
     const split2 = parts[1].split(endMarker);
     if (split2.length >= 2) {
       content = parts[0] + KPI_REPLACEMENT + split2.slice(1).join(endMarker);
     } else {
       console.error("Marker 3b failed.");
     }
  } else {
    console.error("Marker 3a failed.");
  }
}

// 6. fix agg in KPI
let KPI_AGG_TARGET = `
  // 3. Aggregate 
  const totalInvested = netInjected - cash;
  const totalValue = marketValue + cash;
`;

let KPI_AGG_REPLACEMENT = `
  // Convert total cash to EUR
  let totalCashEur = 0;
  for (const [cur, amount] of cashByCurrency.entries()) {
    let fx = latestFx.get(cur) || 1;
    if (cur !== "EUR" && fx === 1) {
      const hFx = getPriceForDay(histories[\`\${cur}EUR=X\`], todayStr);
      if (hFx > 0) fx = hFx;
    }
    totalCashEur += amount * (cur !== "EUR" ? fx : 1);
  }

  // 3. Aggregate 
  const totalInvested = netInjected - totalCashEur;
  const totalValue = marketValue + totalCashEur;
`;

if (content.includes("const totalInvested = netInjected - cash;")) {
  content = content.replace(KPI_AGG_TARGET, KPI_AGG_REPLACEMENT);
} else {
  console.error("Marker 4 failed.");
}

// 7. fix return
let KPI_RET_TARGET = `
  return {
    cash,
    totalInvested,
    realizedPl,
    unrealizedPl,
    totalPl,
    marketValue,
    totalValue,
  };`;

let KPI_RET_REPLACEMENT = `
  return {
    cash: totalCashEur,
    totalInvested,
    realizedPl,
    unrealizedPl,
    totalPl,
    marketValue,
    totalValue,
  };`;

if (content.includes("cash,")) {
  content = content.replace(KPI_RET_TARGET, KPI_RET_REPLACEMENT);
}

fs.writeFileSync("src/pages/TestImport.tsx", content);
console.log("Done patching TestImport.tsx");
