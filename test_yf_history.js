const ticker = "AAPL";
const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1mo&range=max`;
fetch(url)
  .then(res => res.json())
  .then(data => {
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const close = result.indicators.quote[0].close;
    console.log(`Fetched ${timestamps.length} historical prices for ${ticker}`);
    console.log(`Last price: ${close[close.length - 1]}`);
  })
  .catch(console.error);
