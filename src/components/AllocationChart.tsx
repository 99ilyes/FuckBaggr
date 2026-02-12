import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { AssetPosition, formatCurrency } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(263, 70%, 50%)",
  "hsl(330, 81%, 60%)",
  "hsl(190, 95%, 39%)",
  "hsl(25, 95%, 53%)",
  "hsl(160, 60%, 45%)",
  "hsl(45, 93%, 47%)",
  "hsl(200, 98%, 39%)",
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

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
        <p className="font-medium text-foreground">{d.name}</p>
        <p className="text-muted-foreground">{formatCurrency(d.value)} · {pct}%</p>
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
          <ResponsiveContainer width="40%" height={180}>
            <PieChart>
              <Pie
                data={sorted}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                paddingAngle={2}
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
          <div className="flex-1 overflow-y-auto max-h-[180px] space-y-0.5 pr-1" style={{ scrollbarWidth: "thin" }}>
            {sorted.map((d, i) => {
              const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
              return (
                <div key={d.name} className="flex items-center justify-between text-xs py-1 px-1.5 rounded hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-foreground truncate">{d.name}</span>
                  </div>
                  <span className="text-muted-foreground tabular-nums shrink-0 ml-3">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
