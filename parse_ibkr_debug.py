from bs4 import BeautifulSoup

print("=== IBKR HTML PARSING DEBUG ===")
with open('U19321556_20250224_20260205.htm', 'r', encoding='utf-8-sig') as f:
    soup = BeautifulSoup(f, 'html.parser')

tables = soup.find_all('table')
for i, t in enumerate(tables):
    rows = t.find_all('tr')
    if not rows: continue
    
    header_cells = rows[0].find_all(['th', 'td'])
    headers = [c.get_text(strip=True) for c in header_cells]
    
    text = t.get_text()
    if ('Date' in headers or 'Symbole' in headers) and len(headers) >= 3:
        print(f"\n--- Table [{i}] Headers: {headers} ---")
        for r in rows[1:6]:  # print up to 5 rows
            cells = [td.get_text(strip=True) for td in r.find_all('td')]
            if cells: print(cells)
