import pandas as pd
import yfinance as yf
from datetime import datetime

tickers = ["WPEA.PA", "CSX5.AS", "AI.PA", "ESE.PA", "PUST.PA", "NBIS.PA", "RACE.MI", "DCAM.PA", "DYDD.PA", "STLAP.PA", "LVMH.PA", "OR.PA", "SU.PA", "MC.PA", "TTE.PA"]

for t in tickers:
    try:
        data = yf.Ticker(t).history(period="1y")
        if not data.empty:
            start_price = data['Close'].iloc[0]
            end_price = data['Close'].iloc[-1]
            ret = (end_price / start_price) - 1
            print(f"{t}: start = {start_price:.2f}, end = {end_price:.2f}, return = {ret:.2%}")
        else:
            print(f"{t}: no data")
    except Exception as e:
        print(f"{t}: error {e}")
