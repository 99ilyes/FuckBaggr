import re
from bs4 import BeautifulSoup

with open('U19321556_20250224_20260205.htm', 'r', encoding='utf-8-sig') as f:
    soup = BeautifulSoup(f, 'html.parser')

print("=== IBKR HTML PARSING DEBUG 4 ===")
for i, el in enumerate(soup.find_all(['table', 'div', 'h2', 'h3'])):
    text = el.get_text(strip=True).lower()
    if 'transactions' in text or 'dépôts et retraits' in text:
        if el.name in ['h2', 'h3', 'div']:
            print(f"\n--- Found Heading/Div [{i}]: {el.get_text(strip=True)} ---")
            # find next table
            next_table = el.find_next_sibling('table')
            if next_table:
                print(f"Next Table Headers:")
                rows = next_table.find_all('tr')
                if rows:
                    headers = [c.get_text(strip=True) for c in rows[0].find_all(['th', 'td'])]
                    print(headers)
                    print("Sample rows:")
                    for r in rows[1:4]:
                        cells = [td.get_text(strip=True) for td in r.find_all('td')]
                        if cells: print(cells)
