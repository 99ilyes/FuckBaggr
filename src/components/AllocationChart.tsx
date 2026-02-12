import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { AssetPosition, formatCurrency } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const COLORS = [
  "hsl(217, 91%, 60%)",  // blue
  "hsl(142, 71%, 45%)",  // green
  "hsl(38, 92%, 50%)",   // amber
  "hsl(0, 84%, 60%)",    // red
  "hsl(263, 70%, 50%)",  // violet
  "hsl(330, 81%, 60%)",  // pink
  "hsl(190, 95%, 39%)",  // cyan
  "hsl(25, 95%, 53%)",   // orange
  "hsl(160, 60%, 45%)",  // teal
  "hsl(280, 65%, 60%)",  // purple
  "hsl(45, 93%, 47%)",   // yellow
  "hsl(200, 98%, 39%)",  // sky
];

interface AllocationItem {
  name: string;
  value: number;
}

interface Props {
  data?: AllocationItem[];
  positions?: AssetPosition[];
  title?: string;
  groupBy?: "asset" | "sector";
}

export function AllocationChart({ data: externalData, positions, title = "Répartition", groupBy = "asset" }: Props) {
  const data: AllocationItem[] = externalData || (
    groupBy === "sector"
      ? Object.entries(
        (positions || []).reduce((acc, p) => {
          const key = p.sector || "Autre";
          acc[key] = (acc[key] || 0) + p.currentValue;
          return acc;
        }, {} as Record<string, number>)
      ).map(([name, value]) => ({ name, value }))
      : (positions || []).map((p) => ({ name: p.ticker, value: p.currentValueBase ?? p.currentValue }))
  );

  const sorted = [...data].sort((a, b) => b.value - a.value);

  if (sorted.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Aucune donnée
        </CardContent>
      </Card>
    );
  }

  const total = sorted.reduce((s, d) => s + d.value, 0);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
    return (
      <div style={{
        backgroundColor: "hsl(228, 12%, 11%)",
        border: "1px solid hsl(228, 10%, 18%)",
        borderRadius: 8, padding: "8px 12px", fontSize: 12, lineHeight: 1.6,
      }}>
        <p style={{ color: "hsl(215, 15%, 85%)", fontWeight: 600 }}>{d.name}</p>
        <p style={{ color: "hsl(217, 91%, 60%)" }}>{formatCurrency(d.value)}</p>
        <p style={{ color: "hsl(215, 15%, 55%)" }}>{pct}%</p>
      </div>
    );
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-4">
          <ResponsiveContainer width="45%" height={200}>
            <PieChart>
              <Pie
                data={sorted}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={85}
                paddingAngle={1.5}
                dataKey="value"
                stroke="none"
              >
                {sorted.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 overflow-y-auto max-h-[200px] space-y-1 pr-1" style={{ scrollbarWidth: "thin" }}>
            {sorted.map((d, i) => {
              const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
              return (
                <div key={d.name} className="flex items-center justify-between text-xs py-0.5 group hover:bg-muted/20 rounded px-1 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className="text-foreground truncate">{d.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-muted-foreground tabular-nums">{formatCurrency(d.value)}</span>
                    <span className="text-muted-foreground tabular-nums w-12 text-right">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
