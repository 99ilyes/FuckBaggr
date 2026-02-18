
import { YahooFinance } from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

async function test() {
    const tickers = ['AAPL', 'MSFT', 'EURUSD=X'];
    console.log('Testing tickers:', tickers);

    for (const ticker of tickers) {
        try {
            const q = await yahooFinance.quote(ticker);
            console.log(`\nTicker: ${ticker}`);
            console.log('Price:', q.regularMarketPrice);
            console.log('Previous Close:', q.regularMarketPreviousClose);
            console.log('Keys:', Object.keys(q));
        } catch (err) {
            console.error(`Error for ${ticker}:`, err);
        }
    }
}

test();
