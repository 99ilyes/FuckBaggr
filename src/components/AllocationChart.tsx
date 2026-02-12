import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { AssetPosition, formatCurrency } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLogoDomain } from "./TickerLogo";

// Brand colors for well-known tickers
const BRAND_COLORS: Record<string, string> = {
  // Tech
  NVDA: "#76B900",  // NVIDIA green
  GOOG: "#4285F4",  // Google blue
  GOOGL: "#4285F4",
  AAPL: "#A2AAAD",  // Apple silver
  MSFT: "#00A4EF",  // Microsoft blue
  AMZN: "#FF9900",  // Amazon orange
  META: "#0082FB",  // Meta blue
  TSLA: "#CC0000",  // Tesla red
  TSM: "#D71920",  // TSMC red
  AMD: "#ED1C24",  // AMD red
  INTC: "#0071C5",  // Intel blue
  NFLX: "#E50914",  // Netflix red
  CRM: "#00A1E0",  // Salesforce blue
  ADBE: "#FF0000",  // Adobe red
  ORCL: "#F80000",  // Oracle red
  CSCO: "#1BA0D7",  // Cisco blue
  AVGO: "#CC092F",  // Broadcom red
  QCOM: "#3253DC",  // Qualcomm blue
  IBM: "#0530AD",  // IBM blue

  // Finance
  NU: "#820AD1",  // Nubank purple
  "BRK-B": "#6B0F24",  // Berkshire burgundy
  JPM: "#0E3A74",  // JPMorgan blue
  V: "#1A1F71",  // Visa dark blue
  MA: "#EB001B",  // Mastercard red
  GS: "#6EAEDE",  // Goldman light blue
  BAC: "#012169",  // BofA blue
  MS: "#003986",  // Morgan Stanley blue

  // ETFs / Gold
  "GOLD-EUR.PA": "#FFD700", // Gold
  GLD: "#FFD700",
  GC: "#FFD700",
  SPY: "#005A9C",    // S&P 500 blue
  QQQ: "#7B3FE4",    // Nasdaq purple
  VTI: "#96151D",    // Vanguard red
  VOO: "#96151D",

  // Japanese
  "6857.T": "#0067B1",  // Advantest blue
  "7203.T": "#EB0A1E",  // Toyota red
  "6758.T": "#000000",  // Sony black → use dark teal instead
  "9984.T": "#FFCC00",  // SoftBank yellow

  // French
  "B28A.PA": "#0060A9",  // Believe blue
  "AI.PA": "#0051A5",  // Air Liquide blue
  "MC.PA": "#5C4033",  // LVMH brown/gold
  "OR.PA": "#000000",  // L'Oréal → use warm black
  "SAN.PA": "#EF3340",  // Sanofi red
  "BNP.PA": "#009A44",  // BNP green
  "SU.PA": "#00529B",  // Schneider blue
  "CAP.PA": "#0070AD",  // Capgemini blue

  // Portfolios
  CTO: "#4285F4",  // Blue
  PEA: "#FF9900",  // Orange
  "Crédit": "#34A853",  // Green
};

// Fallback palette for unknown tickers (distinct, muted, professional)
const FALLBACK_COLORS = [
  "#6366F1", // indigo
  "#14B8A6", // teal
  "#F59E0B", // amber
  "#EC4899", // pink
  "#8B5CF6", // violet
  "#06B6D4", // cyan
  "#F97316", // orange
  "#10B981", // emerald
  "#E11D48", // rose
  "#3B82F6", // blue
];

function getColor(name: string, index: number): string {
  // Try exact match
  if (BRAND_COLORS[name]) return BRAND_COLORS[name];

  // Try without exchange suffix (e.g., "NVDA" from "NVDA.PA")
  const base = name.split(".")[0];
  if (BRAND_COLORS[base]) return BRAND_COLORS[base];

  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

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
  const totalRaw = sorted.reduce((s, d) => s + d.value, 0);

  let chartData: AllocationItem[] = [];
  let otherValue = 0;

  // Keep top items that are at least 2% of total, or max 12 items
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

  // Custom label render function
  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, index, name }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = outerRadius * 1.25; // Adjusted spacing from 1.4

    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";

    const domain = getLogoDomain(name);
    const hasLogo = !!domain && name !== "Autres";

    // Determine text anchor based on position
    const textAnchor = x > cx ? 'start' : 'end';

    // Adjust spacing
    const imageOffset = x > cx ? 0 : -18;
    const textOffset = hasLogo ? (x > cx ? 22 : -22) : 0;

    return (
      <g>
        {hasLogo && (
          <image
            x={x + imageOffset - (x > cx ? -4 : 4)}
            y={y - 9}
            width={18}
            height={18}
            href={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
            style={{ borderRadius: '4px' }}
          />
        )}
        <text
          x={x + textOffset}
          y={y}
          fill={name === "Autres" ? "#9ca3af" : getColor(name, index)}
          textAnchor={textAnchor}
          dominantBaseline="central"
          className="font-bold"
          style={{ fontSize: '11px', fill: 'hsl(var(--foreground))' }} // Smaller font size
        >
          {`${name} ${pct}%`}
        </text>
      </g>
    );
  };

  return (
    <Card className="border-border/50 col-span-1">
      <CardHeader className="pb-2">
        <CardTitle className="text-xl font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[400px] flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={0}
              outerRadius={110} // Reduced radius to fit in 400px height
              paddingAngle={1}
              dataKey="value"
              stroke="hsl(var(--background))"
              strokeWidth={1}
              label={renderCustomizedLabel}
              labelLine={true}
              isAnimationActive={true}
            >
              {chartData.map((item, i) => (
                <Cell
                  key={i}
                  fill={item.name === "Autres" ? "#6b7280" : getColor(item.name, i)}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
