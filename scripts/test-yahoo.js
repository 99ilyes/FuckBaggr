
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pkg = require('yahoo-finance2');

const YahooFinance = pkg.YahooFinance || pkg.default;
const yahooFinance = new YahooFinance();

async function test() {
    const tickers = ['NBIS', 'AAPL']; // Nebius and Apple
    console.log('Testing tickers:', tickers);

    for (const ticker of tickers) {
        try {
            const q = await yahooFinance.quote(ticker);
            console.log(`\nTicker: ${ticker}`);
            console.log('Price:', q.regularMarketPrice);
            console.log('Previous Close:', q.regularMarketPreviousClose);
            console.log('Change:', q.regularMarketChange);
            console.log('Change Percent:', q.regularMarketChangePercent);
        } catch (err) {
            console.error(`Error for ${ticker}:`, err);
        }
    }
}

test();
