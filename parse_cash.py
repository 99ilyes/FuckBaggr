from bs4 import BeautifulSoup
import codecs

with codecs.open('U19321556_20250224_20260205.htm', 'r', 'utf-8-sig') as f:
    soup = BeautifulSoup(f, 'html.parser')

tables = soup.find_all('table')

# Look specifically for Table 10 (Dépôts et retraits) in the file
for t in tables:
    text = t.get_text()
    if 'Transfert électronique' in text or 'Déboursement' in text:
        rows = t.find_all('tr')
        if not rows: continue
        headers = [c.get_text(strip=True) for c in rows[0].find_all(['th', 'td'])]
        if 'Date' in headers and 'Description' in headers and 'Montant' in headers:
            print(f"--- CANDIDATE CASH TABLE ---")
            for r in rows[1:]:
                cells = [td.get_text(strip=True) for td in r.find_all('td')]
                print(cells)

