from bs4 import BeautifulSoup
import codecs

with codecs.open('U19321556_20250224_20260205.htm', 'r', 'utf-8-sig') as f:
    soup = BeautifulSoup(f, 'html.parser')

tables = soup.find_all('table')
with open('ibkr_dump.txt', 'w', encoding='utf-8') as out:
    for i, t in enumerate(tables):
        rows = t.find_all('tr')
        if not rows: continue
        headers = [c.get_text(strip=True) for c in rows[0].find_all(['th', 'td'])]
        out.write(f"\n--- Table [{i}] Headers: {headers} ---\n")
        for r in rows[1:]:
            cells = [td.get_text(strip=True) for td in r.find_all('td')]
            out.write(str(cells) + "\n")
