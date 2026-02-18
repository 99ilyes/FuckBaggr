
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pkg = require('yahoo-finance2');
// It seems pkg might be { default: [class YahooFinance], YahooFinance: [class YahooFinance] } or similar
// The error says "Call const yahooFinance = new YahooFinance() first"
// which implies we got the class but tried to use it as instance or vice versa.

const YahooFinance = pkg.YahooFinance || pkg.default;
const yahooFinance = new YahooFinance();

async function test() {
    const tickers = ['AAPL', 'MSFT', 'EURUSD=X'];
    console.log('Testing tickers:', tickers);

    for (const ticker of tickers) {
        try {
            // console.log('Imported:', yahooFinance);
            const q = await yahooFinance.quote(ticker);
            console.log(`\nTicker: ${ticker}`);
            console.log('Price:', q.regularMarketPrice);
            console.log('Previous Close:', q.regularMarketPreviousClose);
        } catch (err) {
            console.error(`Error for ${ticker}:`, err);
        }
    }
}

test();
