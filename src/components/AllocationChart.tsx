import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { AssetPosition, formatCurrency } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TickerLogo } from "./TickerLogo";
import { ScrollArea } from "@/components/ui/scroll-area";

const BRAND_COLORS: Record<string, string> = {
  NVDA: "#76B900", GOOG: "#4285F4", GOOGL: "#4285F4",
  AAPL: "#A2AAAD", MSFT: "#00A4EF", AMZN: "#FF9900",
  META: "#0082FB", TSLA: "#CC0000", TSM: "#D71920",
  AMD: "#ED1C24", INTC: "#0071C5", NFLX: "#E50914",
  CRM: "#00A1E0", ADBE: "#FF0000", ORCL: "#F80000",
  CSCO: "#1BA0D7", AVGO: "#CC092F", QCOM: "#3253DC",
  IBM: "#0530AD", NU: "#820AD1", "BRK-B": "#6B0F24",
  JPM: "#0E3A74", V: "#1A1F71", MA: "#EB001B",
  GS: "#6EAEDE", BAC: "#012169", MS: "#003986",
  "GOLD-EUR.PA": "#FFD700", GLD: "#FFD700", GC: "#FFD700",
  SPY: "#005A9C", QQQ: "#7B3FE4", VTI: "#96151D", VOO: "#96151D",
  "6857.T": "#0067B1", "7203.T": "#EB0A1E", "6758.T": "#000000",
  "9984.T": "#FFCC00", "B28A.PA": "#0060A9", "AI.PA": "#0051A5",
  "MC.PA": "#5C4033", "OR.PA": "#000000", "SAN.PA": "#EF3340",
  "BNP.PA": "#009A44", "SU.PA": "#00529B", "CAP.PA": "#0070AD",
  CTO: "#4285F4", PEA: "#FF9900", "Crédit": "#34A853",
};

const FALLBACK_COLORS = [
  "#6366F1", "#14B8A6", "#F59E0B", "#EC4899", "#8B5CF6",
  "#06B6D4", "#F97316", "#10B981", "#E11D48", "#3B82F6",
];

function getColor(name: string, index: number): string {
  if (BRAND_COLORS[name]) return BRAND_COLORS[name];
  const base = name.split(".")[0];
  if (BRAND_COLORS[base]) return BRAND_COLORS[base];
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

interface AllocationItem { name: string; value: number; }

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
  const totalRaw = sorted.reduce((s, d) => s + d.value, 0);

  let chartData: AllocationItem[] = [];
  let otherValue = 0;

  sorted.forEach((item, index) => {
    const pct = totalRaw > 0 ? (item.value / totalRaw) : 0;
    if (index < 14 && pct >= 0.02) {
      chartData.push(item);
    } else {
      otherValue += item.value;
    }
  });

  if (otherValue > 0) {
    chartData.push({ name: "Autres", value: otherValue });
  }

  const total = chartData.reduce((s, d) => s + d.value, 0);

  if (chartData.length === 0) {
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
    <Card className="border-border/50 col-span-1">
      <CardHeader className="pb-2">
        <CardTitle className="text-xl font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[320px]">
        <div className="flex h-full gap-2">
          {/* Donut chart */}
          <div className="w-[45%] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={100}
                  paddingAngle={1}
                  dataKey="value"
                  stroke="hsl(var(--background))"
                  strokeWidth={1}
                  isAnimationActive={true}
                >
                  {chartData.map((item, i) => (
                    <Cell key={i} fill={item.name === "Autres" ? "#6b7280" : getColor(item.name, i)} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex-1 min-w-0">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-1.5 pr-2">
                {chartData.map((item, i) => {
                  const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
                  const color = item.name === "Autres" ? "#6b7280" : getColor(item.name, i);
                  return (
                    <div key={item.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      {item.name !== "Autres" && (
                        <TickerLogo ticker={item.name} />
                      )}
                      <span className="truncate text-foreground">{item.name}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
