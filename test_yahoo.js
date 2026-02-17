async function test() {
    try {
        console.log("Fetching cookies...");
        const pageResp = await fetch("https://finance.yahoo.com/quote/AAPL", {
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            redirect: "follow",
        });

        // Node.js fetch might return multiple set-cookie headers differently
        // In browser environment headers.get("set-cookie") returns one string combined, but node might return distinct headers?
        // Let's assume standard fetch behavior or try to extract raw headers if needed.
        const cookies = pageResp.headers.get("set-cookie");
        console.log("Cookies found:", !!cookies);

        console.log("Fetching crumb...");
        const crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Cookie": cookies || "",
            },
        });
        const crumb = await crumbResp.text();
        console.log("Crumb:", crumb);

        console.log("Fetching quotes...");
        const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=AAPL,ADYEN.AS,RACE.MI&crumb=${encodeURIComponent(crumb)}`;
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Cookie": cookies || "",
            },
        });

        if (!response.ok) {
            console.error("Status:", response.status);
            console.error("Text:", await response.text());
            return;
        }

        const data = await response.json();
        const result = data.quoteResponse?.result || [];
        console.log("Found", result.length, "quotes");
        result.forEach(r => {
            console.log(`${r.symbol}: TTM_PE=${r.trailingPE} epsTTM=${r.epsTrailingTwelveMonths} Price=${r.regularMarketPrice}`);
        });

    } catch (e) {
        console.error(e);
    }
}
test();
