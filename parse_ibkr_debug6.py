import re
from bs4 import BeautifulSoup

with open('U19321556_20250224_20260205.htm', 'r', encoding='utf-8-sig') as f:
    soup = BeautifulSoup(f, 'html.parser')

print("--- SEARCH TEXT ---")
texts = soup.find_all(string=re.compile("Dépôts|Transactions", re.I))
for t in texts:
    print(t.strip())
