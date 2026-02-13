import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { AssetPosition, formatCurrency } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLogoUrl } from "./TickerLogo";

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
  PYPL: "#003087",  // PayPal blue
  SHOP: "#95BF47",  // Shopify green
  UBER: "#000000",  // Uber black
  ABNB: "#FF5A5F",  // Airbnb red
  COIN: "#1652F0",  // Coinbase blue
  SQ: "#000000",    // Block black
  PLTR: "#000000",  // Palantir black -> Use dark gray for vis
  SNOW: "#29B5E8",  // Snowflake blue

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
  "6758.T": "#5865F2",  // Sony blueish (custom)
  "9984.T": "#FFCC00",  // SoftBank yellow

  // French
  "B28A.PA": "#0060A9",  // Believe blue
  "AI.PA": "#0051A5",  // Air Liquide blue
  "MC.PA": "#5C4033",  // LVMH brown/gold
  "OR.PA": "#000000",  // L'Oréal 
  "SAN.PA": "#EF3340",  // Sanofi red
  "BNP.PA": "#009A44",  // BNP green
  "SU.PA": "#00529B",  // Schneider blue
  "CAP.PA": "#0070AD",  // Capgemini blue
  "RMS.PA": "#F37021",  // Hermes orange
  "TTE.PA": "#ED0000",  // Total red
  "GTT.PA": "#009BDB",  // GTT blue

  // Latam
  MELI: "#FFE600", // MercadoLibre yellow

  // Others
  NBIS: "#000000",
  GEV: "#005F9E",

  // Portfolios (fallback)
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
  const chartData = sorted;
  const total = chartData.reduce((s, d) => s + d.value, 0);

  // Pre-calculate layout to prevent overlap with Smart Layout
  const layout = useMemo(() => {
    if (total === 0) return {};

    // We assume the chart container has roughly these dimensions
    // We use a fixed layout logic where cx, cy are relative to the chart center
    const cy = 200; // Conceptual center Y (400/2)
    const cx = 200; // Conceptual center X
    const innerRadius = 105;
    const labelRadius = 155;

    let currentAngle = 90; // Start at 12 o'clock

    // Temporary storage for labels
    const rightLabels: any[] = [];
    const leftLabels: any[] = [];

    const items = chartData.map((item, index) => {
      const sliceAngle = (item.value / total) * 360;
      const midAngle = currentAngle - sliceAngle / 2; // Clockwise subtraction
      currentAngle -= sliceAngle;

      const rad = Math.PI / 180;

      // Calculate standard position
      // In Recharts 'endAngle' system, 0 is right, 90 is top.
      // But we are managing angle manually.
      // x = cos(theta), y = -sin(theta) (screen coords, y=down)
      // If midAngle=90 (top), cos=0, sin=1 => y negative (up). Correct.

      const xRaw = Math.cos(midAngle * rad);
      const yRaw = -Math.sin(midAngle * rad);

      const isRight = xRaw >= 0;

      // Initial Ideal Y
      const idealY = cy + yRaw * labelRadius;

      const labelObj = {
        name: item.name,
        value: item.value,
        index,
        midAngle,
        isRight,
        y: idealY, // Mutable
        color: getColor(item.name, index),
        pct: ((item.value / total) * 100).toFixed(1)
      };

      if (isRight) rightLabels.push(labelObj);
      else leftLabels.push(labelObj);

      return labelObj;
    });

    // Relaxation algorithm to prevent Y overlap
    const relax = (list: any[]) => {
      // Sort by Y top-to-bottom
      list.sort((a, b) => a.y - b.y);
      const minSpacing = 26; // Pixels between labels

      // Push down
      for (let i = 1; i < list.length; i++) {
        if (list[i].y < list[i - 1].y + minSpacing) {
          list[i].y = list[i - 1].y + minSpacing;
        }
      }

      // Center the whole group vertically around center if possible (optional)
      // This helps if everything got pushed too far down
      if (list.length > 0) {
        const top = list[0].y;
        const bottom = list[list.length - 1].y;
        const height = bottom - top;
        const center = (top + bottom) / 2;
        const offset = cy - center; // Shift to align with actual vertical center

        // Apply shift, but limited to avoid pushing off screen?
        // Let's just apply it.
        list.forEach(l => l.y += offset);
      }

      // Assign final X Anchor
      const xOffset = 160;
      list.forEach(l => {
        l.finalXOffset = l.isRight ? xOffset : -xOffset;
        l.textAnchor = l.isRight ? "start" : "end";
      });
    };

    relax(rightLabels);
    relax(leftLabels);

    // Convert array to map for render
    const map: Record<string, any> = {};
    items.forEach(i => map[i.name] = i);
    return map;

  }, [total, chartData]);

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

  // Custom renderer requires access to current cx, cy provided by Recharts
  const renderCustomizedLabel = (props: any) => {
    const { cx, cy, name, outerRadius, midAngle } = props;
    const item = layout[name];
    if (!item) return null;

    // We calculated Y relative to 200. Now apply to actual cy.
    const yDelta = item.y - 200;
    const finalY = cy + yDelta;
    const finalX = cx + item.finalXOffset;

    // Start of line (on the slice)
    const rad = Math.PI / 180;
    const sx = cx + outerRadius * Math.cos(-midAngle * rad);
    const sy = cy + outerRadius * Math.sin(-midAngle * rad);

    // Elbow point (outwards)
    const elbowRadius = outerRadius + 15;
    const ex = cx + elbowRadius * Math.cos(-midAngle * rad);
    const ey = cy + elbowRadius * Math.sin(-midAngle * rad);

    const logoUrl = getLogoUrl(name);

    // Adjust text/image positions relative to finalX
    const isRight = item.isRight;
    const imageX = isRight ? finalX + 8 : finalX - 8 - 18;
    const textX = isRight
      ? (logoUrl ? finalX + 32 : finalX + 8)
      : (logoUrl ? finalX - 32 : finalX - 8);

    return (
      <g>
        <path
          d={`M${sx},${sy} L${ex},${ey} L${finalX},${finalY}`}
          stroke={item.color}
          fill="none"
          opacity={0.5}
          strokeWidth={1}
        />

        {logoUrl && (
          <image
            x={imageX}
            y={finalY - 9}
            width={18}
            height={18}
            href={logoUrl}
            style={{ borderRadius: '4px' }}
          />
        )}
        <text
          x={textX}
          y={finalY}
          fill={item.color}
          textAnchor={item.textAnchor}
          dominantBaseline="central"
          className="font-bold tracking-tight"
          style={{ fontSize: '11px', fill: 'hsl(var(--foreground))' }}
        >
          {`${name} ${item.pct}%`}
        </text>
      </g>
    );
  };

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
      <CardContent className="h-[400px] flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              startAngle={90}
              endAngle={-270}
              innerRadius={0}
              outerRadius={105}
              paddingAngle={1}
              dataKey="value"
              stroke="hsl(var(--background))"
              strokeWidth={1}
              label={renderCustomizedLabel}
              labelLine={false}
              isAnimationActive={true}
            >
              {chartData.map((item, i) => (
                <Cell
                  key={i}
                  fill={getColor(item.name, i)}
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
