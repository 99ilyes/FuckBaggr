from bs4 import BeautifulSoup
import sys

with open("U19321556_20250224_20260205.htm", "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f, "html.parser")

for i, table in enumerate(soup.find_all("table")):
    rows = table.find_all("tr")
    if not rows: continue
    
    header_cells = rows[0].find_all(["th", "td"])
    headers = [c.get_text(strip=True) for c in header_cells]
    
    # Try finding the first data row or title
    print(f"Table {i}: {headers}")
    if len(rows) > 1:
        cells = rows[1].find_all(["th", "td"])
        print(f"  Row 1: {[c.get_text(strip=True) for c in cells]}")
