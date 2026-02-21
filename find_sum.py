import itertools

deposits = [5.0, 30.0, 700.0, 499.98, 40.85, 489.93, 500.0, 500.0, 1000.0, 302.0, 500.0, 83.0, 5.0, 10.0, 500.62, 2.0, 1503.34, 107.76, 21.37]

transfers = [
    372.48, # AI
    5941.50, # WPEA
    1479.20, # CSX5
    1125.62, # ESE
    1027.88, # PUST
]

divs = [5.44, 8.16]

all_vals = deposits + transfers + divs

target = 16809.66

for r in range(len(all_vals)-2, len(all_vals)+1):
    for c in itertools.combinations(all_vals, r):
        if abs(sum(c) - target) < 0.05:
            print(f"MATCH: {sum(c)} with {c}")
            
print("Search done.")
