from bs4 import BeautifulSoup
import re

with open('U19321556_20250224_20260205.htm', 'r', encoding='utf-8-sig') as f:
    soup = BeautifulSoup(f, 'html.parser')

print("--- EXAMINING HEADINGS ---")
for el in soup.find_all(string=re.compile("Transactions|Dépôts et retraits", re.I)):
    parent = el.parent
    print(f"Text: '{el.strip()}', Tag: {parent.name}")
    
    # Try finding nearest table
    table = parent.find_next('table')
    if table:
        rows = table.find_all('tr')
        if rows:
            print("  --> Nearest Table Headers:", [c.get_text(strip=True) for c in rows[0].find_all(['th', 'td'])])
