from bs4 import BeautifulSoup

def summarize_table(t):
    rows = t.find_all('tr')
    if not rows: return
    headers = [th.get_text(strip=True) for th in rows[0].find_all(['th', 'td'])]
    print(f"--- Table Headers: {headers} ---")
    for r in rows[1:4]:
        cells = [td.get_text(strip=True) for td in r.find_all('td')]
        if cells: print(cells)

try:
    with open('U19321556_20250224_20260205.htm', 'r', encoding='utf-8-sig') as f:
        soup = BeautifulSoup(f, 'html.parser')
        tables = soup.find_all('table')
        for t in tables:
            text = t.get_text()
            if "Symbole" in text and ("Achat" in text or "Vente" in text or "Dépôts" in text or "Date" in text):
                summarize_table(t)
            elif "Date" in text and "Montant" in text:
                summarize_table(t)
except Exception as e:
    print(e)
