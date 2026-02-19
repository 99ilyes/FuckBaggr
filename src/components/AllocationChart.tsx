import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { AssetPosition, formatCurrency } from "@/lib/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLogoUrl } from "./TickerLogo";
import { useIsMobile } from "@/hooks/use-mobile";

// Brand colors for well-known tickers
const BRAND_COLORS: Record<string, string> = {
  // Tech
  NVDA: "#76B900",
  GOOG: "#4285F4",
  GOOGL: "#4285F4",
  AAPL: "#A2AAAD",
  MSFT: "#00A4EF",
  AMZN: "#FF9900",
  META: "#0082FB",
  TSLA: "#CC0000",
  TSM: "#D71920",
  AMD: "#ED1C24",
  INTC: "#0071C5",
  NFLX: "#E50914",
  CRM: "#00A1E0",
  ADBE: "#FF0000",
  ORCL: "#F80000",
  CSCO: "#1BA0D7",
  AVGO: "#CC092F",
  QCOM: "#3253DC",
  IBM: "#0530AD",
  PYPL: "#003087",
  SHOP: "#95BF47",
  UBER: "#000000",
  ABNB: "#FF5A5F",
  COIN: "#1652F0",
  SQ: "#000000",
  PLTR: "#000000",
  SNOW: "#29B5E8",
  // Finance
  NU: "#820AD1",
  "BRK-B": "#6B0F24",
  JPM: "#0E3A74",
  V: "#1A1F71",
  MA: "#EB001B",
  GS: "#6EAEDE",
  BAC: "#012169",
  MS: "#003986",
  // ETFs / Gold
  "GOLD-EUR.PA": "#FFD700",
  GLD: "#FFD700",
  GC: "#FFD700",
  SPY: "#005A9C",
  QQQ: "#7B3FE4",
  VTI: "#96151D",
  VOO: "#96151D",
  // Japanese
  "6857.T": "#91003C",
  "7203.T": "#EB0A1E",
  "6758.T": "#5865F2",
  "9984.T": "#FFCC00",
  // French
  "B28A.PA": "#0060A9",
  "AI.PA": "#0051A5",
  "MC.PA": "#5C4033",
  "OR.PA": "#000000",
  "SAN.PA": "#EF3340",
  "BNP.PA": "#009A44",
  "SU.PA": "#00529B",
  "CAP.PA": "#0070AD",
  "RMS.PA": "#F37021",
  "TTE.PA": "#ED0000",
  "GTT.PA": "#009BDB",
  "ADYEN.AS": "#0ABF53",
  // Latam
  MELI: "#FFE600",
  // Others
  NBIS: "#33C481",
  GEV: "#005F9E",
  // Portfolios (fallback)
  CTO: "#4285F4",
  PEA: "#FF9900",
  "Crédit": "#34A853",
  // User requests
  ASML: "#272A78",
  "ASML.AS": "#272A78",
  RACE: "#D40000",
  "RACE.MI": "#D40000",
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
  const isMobile = useIsMobile();

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
  const total = sorted.reduce((s, d) => s + d.value, 0);

  // On mobile, group small positions into "Autres"
  const chartData = useMemo(() => {
    if (!isMobile) return sorted;
    const maxItems = 10;
    const minPct = 0.02;
    const main: AllocationItem[] = [];
    let othersValue = 0;
    sorted.forEach((item, i) => {
      if (i < maxItems && (total === 0 || item.value / total >= minPct)) {
        main.push(item);
      } else {
        othersValue += item.value;
      }
    });
    if (othersValue > 0) main.push({ name: "Autres", value: othersValue });
    return main;
  }, [sorted, total, isMobile]);

  // Desktop: pre-calculate label layout for anti-overlap
  const layout = useMemo(() => {
    if (isMobile || total === 0) return {};

    const cy = 200;
    const labelRadius = 155;
    let currentAngle = 90;

    const rightLabels: any[] = [];
    const leftLabels: any[] = [];

    const items = chartData.map((item, index) => {
      const sliceAngle = (item.value / total) * 360;
      const midAngle = currentAngle - sliceAngle / 2;
      currentAngle -= sliceAngle;

      const rad = Math.PI / 180;
      const xRaw = Math.cos(midAngle * rad);
      const yRaw = -Math.sin(midAngle * rad);
      const isRight = xRaw >= 0;
      const idealY = cy + yRaw * labelRadius;

      const labelObj = {
        name: item.name, value: item.value, index, midAngle, isRight,
        y: idealY, color: getColor(item.name, index),
        pct: ((item.value / total) * 100).toFixed(1)
      };

      if (isRight) rightLabels.push(labelObj);
      else leftLabels.push(labelObj);
      return labelObj;
    });

    const relax = (list: any[]) => {
      list.sort((a, b) => a.y - b.y);
      const minSpacing = 26;
      for (let i = 1; i < list.length; i++) {
        if (list[i].y < list[i - 1].y + minSpacing) {
          list[i].y = list[i - 1].y + minSpacing;
        }
      }
      if (list.length > 0) {
        const center = (list[0].y + list[list.length - 1].y) / 2;
        const offset = cy - center;
        list.forEach(l => l.y += offset);
      }
      const xOffset = 160;
      list.forEach(l => {
        l.finalXOffset = l.isRight ? xOffset : -xOffset;
        l.textAnchor = l.isRight ? "start" : "end";
      });
    };

    relax(rightLabels);
    relax(leftLabels);

    const map: Record<string, any> = {};
    items.forEach(i => map[i.name] = i);
    return map;
  }, [total, chartData, isMobile]);

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

  // Desktop label renderer
  const renderCustomizedLabel = (props: any) => {
    const { cx, cy, name, outerRadius, midAngle } = props;
    const item = layout[name];
    if (!item) return null;

    const yDelta = item.y - 200;
    const finalY = cy + yDelta;
    const finalX = cx + item.finalXOffset;

    const rad = Math.PI / 180;
    const sx = cx + outerRadius * Math.cos(-midAngle * rad);
    const sy = cy + outerRadius * Math.sin(-midAngle * rad);

    const elbowRadius = outerRadius + 15;
    const ex = cx + elbowRadius * Math.cos(-midAngle * rad);
    const ey = cy + elbowRadius * Math.sin(-midAngle * rad);

    const logoUrl = getLogoUrl(name);
    const isRight = item.isRight;
    const imageX = isRight ? finalX + 8 : finalX - 8 - 18;
    const textX = isRight
      ? (logoUrl ? finalX + 32 : finalX + 8)
      : (logoUrl ? finalX - 32 : finalX - 8);

    return (
      <g>
        <path
          d={`M${sx},${sy} L${ex},${ey} L${finalX},${finalY}`}
          stroke={item.color} fill="none" opacity={0.5} strokeWidth={1}
        />
        {logoUrl && (
          <image x={imageX} y={finalY - 9} width={18} height={18}
            href={logoUrl} style={{ borderRadius: '4px' }} />
        )}
        <text x={textX} y={finalY} fill={item.color}
          textAnchor={item.textAnchor} dominantBaseline="central"
          className="font-bold tracking-tight"
          style={{ fontSize: '11px', fill: 'hsl(var(--foreground))' }}>
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

  if (isMobile) {
    return (
      <Card className="border-border/50 col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-bold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="w-full h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData} cx="50%" cy="50%"
                  startAngle={90} endAngle={-270}
                  innerRadius={40} outerRadius={80}
                  paddingAngle={1} dataKey="value"
                  stroke="hsl(var(--background))" strokeWidth={1}
                  label={false} labelLine={false}
                  isAnimationActive={true}
                >
                  {chartData.map((item, i) => (
                    <Cell key={i} fill={getColor(item.name, i)} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full text-xs">
            {chartData.map((item, i) => {
              const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
              return (
                <div key={item.name} className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: getColor(item.name, i) }}
                  />
                  <span className="truncate text-foreground font-medium">{item.name}</span>
                  <span className="text-muted-foreground ml-auto shrink-0">{pct}%</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 col-span-1">
      <CardHeader className="pb-2">
        <CardTitle className="text-xl font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[400px] flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData} cx="50%" cy="50%"
              startAngle={90} endAngle={-270}
              innerRadius={0} outerRadius={105}
              paddingAngle={1} dataKey="value"
              stroke="hsl(var(--background))" strokeWidth={1}
              label={renderCustomizedLabel} labelLine={false}
              isAnimationActive={true}
            >
              {chartData.map((item, i) => (
                <Cell key={i} fill={getColor(item.name, i)} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
