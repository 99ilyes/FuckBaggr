import pandas as pd

rows = [
    ("2024-08-02", -0.0405, 2390.28, 2491.22, 0.00),
    ("2024-08-05", -0.0219, 2337.91, 2390.28, 0.00),
    ("2024-11-06",  0.0353, 12891.09, 12452.08, 0.00),
    ("2025-01-27", -0.0207, 15798.14, 15621.27, 500.00)
]

cumulative = 1.0
import sys
for line in open("out.log"):
    if "Return =" in line:
        parts = line.split("Return = ")[1].split("%")[0]
        ret = float(parts) / 100.0
        cumulative *= (1 + ret)
print(f"Product of filtered >2% moves: {cumulative - 1:.2%}")
