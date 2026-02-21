export async function fetchHistoricalPrices(ticker: string, startDate: Date): Promise<Record<string, number>> {
  try {
    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    
    const baseUrl = import.meta.env.DEV
      ? "/api/yf"
      : "https://query2.finance.yahoo.com";

    const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}&events=history`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) return {};

    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) return {};

    const timestamps: number[] = result.timestamp;
    const closes: (number | null)[] = result.indicators.quote[0].close;

    const pricesByDate: Record<string, number> = {};
    
    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null) {
            // Convert to YYYY-MM-DD local timezone string
            const d = new Date(timestamps[i] * 1000);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            pricesByDate[dateStr] = closes[i] as number;
        }
    }

    return pricesByDate;
  } catch (err) {
    console.warn(`Failed to fetch historical prices for ${ticker}:`, err);
    return {};
  }
}
