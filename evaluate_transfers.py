import pandas as pd
import yfinance as yf

transfers = [
    ("AI.PA", "2024-07-31", 2, 186.24),
    ("ESE.PA", "2024-07-31", 46, 24.47),
    ("PUST.PA", "2024-07-31", 14, 73.42),
    ("CSX5.AS", "2024-08-23", 8, 184.90),
    ("WPEA.PA", "2024-08-27", 1165, 5.10)
]

total_market_value = 0
total_pru_value = 0

for sym, date, qty, pru in transfers:
    t = yf.Ticker(sym)
    h = t.history(start=date, end=pd.to_datetime(date) + pd.Timedelta(days=5))
    if len(h) == 0:
        print(f"No match for {sym} at {date}")
        continue
    close_price = h['Close'].iloc[0]
    date_found = h.index[0]
    print(f"{sym} on {date_found.date()}: PRU {pru} | Market {close_price:.4f}")
    
    total_market_value += qty * close_price
    total_pru_value += qty * pru

print(f"\nTotal PRU Value: {total_pru_value:.2f}")
print(f"Total Market Value: {total_market_value:.2f}")
