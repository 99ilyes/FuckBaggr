const url = "https://query2.finance.yahoo.com/v1/finance/search?q=FR0013416716&quotesCount=1";
fetch(url).then(r => r.json()).then(data => {
    console.log(JSON.stringify(data.quotes, null, 2));
}).catch(console.error);
