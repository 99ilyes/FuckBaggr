from bs4 import BeautifulSoup

with open('U19321556_20250224_20260205.htm', 'r', encoding='utf-8-sig') as f:
    soup = BeautifulSoup(f, 'html.parser')

tables = soup.find_all('table')
for i, t in enumerate(tables):
    text = t.get_text()
    if 'Forex' in text or 'EUR.USD' in text or 'Conversion' in text or 'Change' in text:
        rows = t.find_all('tr')
        if not rows: continue
        headers = [c.get_text(strip=True) for c in rows[0].find_all(['th', 'td'])]
        print(f"\n--- Table [{i}] Headers: {headers} ---")
        for r in rows[1:]:
            cells = [td.get_text(strip=True) for td in r.find_all('td')]
            print(cells)
