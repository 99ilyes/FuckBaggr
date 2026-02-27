import { useMemo, useCallback, useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from "recharts";
import { AssetPosition, formatCurrency } from "@/lib/calculations";
import { getAllocationColor } from "@/lib/allocationColors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLogoCandidates } from "./TickerLogo";
import { useIsMobile } from "@/hooks/use-mobile";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const DESKTOP_CHART_CENTER_Y = 240;
const DESKTOP_INNER_RADIUS = 95;
const DESKTOP_OUTER_RADIUS = 165;
const DESKTOP_LABEL_X_RIGHT = 200;
const DESKTOP_LABEL_X_LEFT = -200;
const DESKTOP_LABEL_MIN_SPACING = 27;
const DESKTOP_LABEL_MIN_Y = 18;
const DESKTOP_LABEL_MAX_Y = 462;
const MIN_INSIDE_PCT_LABEL = 5.5;
const MIN_OUTER_LABEL_PCT = 1.8;

function isGttTicker(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  return normalized === "GTT" || normalized === "GTT.PA";
}

function loadFirstAvailableLogo(candidates: string[]): Promise<string | null> {
  const urls = candidates.filter((url) => url.length > 0);
  if (urls.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let index = 0;

    const tryNext = () => {
      if (index >= urls.length) {
        resolve(null);
        return;
      }

      const url = urls[index++];
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => tryNext();
      img.src = url;
    };

    tryNext();
  });
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 3 && normalized.length !== 6) return null;
  const expanded = normalized.length === 3
    ? normalized.split("").map((c) => `${c}${c}`).join("")
    : normalized;
  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value)) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function withAlpha(base: string, alpha: number): string {
  const rgb = hexToRgb(base);
  if (!rgb) return base;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

function getContrastTextColor(base: string): string {
  const rgb = hexToRgb(base);
  if (!rgb) return "#F8FAFC";
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.58 ? "#0B0D11" : "#F8FAFC";
}

function getDisplayLabel(name: string): string {
  const base = name.split(".")[0];
  return base.length > 8 ? `${base.slice(0, 8)}…` : base;
}

function getLuminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 1;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

function isVeryDarkColor(color: string): boolean {
  return getLuminance(color) < 0.16;
}

interface AllocationItem {
  name: string;
  value: number;
}

interface PreparedAllocationItem extends AllocationItem {
  color: string;
  pct: number;
}

interface LabelLayoutItem {
  name: string;
  index: number;
  value: number;
  pct: number;
  color: string;
  isRight: boolean;
  midAngleDeg: number;
  y: number;
  finalX: number;
  textAnchor: "start" | "end";
}

interface PieLabelProps {
  cx?: number;
  cy?: number;
  name?: string;
  outerRadius?: number;
  midAngle?: number;
  index?: number;
}

interface TooltipPayloadItem {
  payload: PreparedAllocationItem;
}

interface AllocationTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

interface Props {
  data?: AllocationItem[];
  positions?: AssetPosition[];
  title?: string;
  groupBy?: "asset" | "sector";
  showLogos?: boolean;
  hideAmounts?: boolean;
  allocationMode?: "account" | "asset";
  onAllocationModeChange?: (mode: "account" | "asset") => void;
}

export function AllocationChart({
  data: externalData,
  positions,
  title = "Répartition",
  groupBy = "asset",
  showLogos = true,
  hideAmounts = false,
  allocationMode,
  onAllocationModeChange,
}: Props) {
  const isMobile = useIsMobile();
  const [resolvedLogoUrls, setResolvedLogoUrls] = useState<Record<string, string>>({});

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
  const total = sorted.reduce((sum, item) => sum + item.value, 0);

  // On mobile, group small positions into "Autres" to keep labels readable.
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
  }, [isMobile, sorted, total]);

  const preparedData = useMemo<PreparedAllocationItem[]>(() => {
    return chartData.map((item, index) => {
      const color = getAllocationColor(item.name, index);
      return {
        ...item,
        color,
        pct: total > 0 ? (item.value / total) * 100 : 0,
      };
    });
  }, [chartData, total]);

  useEffect(() => {
    if (!showLogos) {
      setResolvedLogoUrls({});
      return;
    }

    const uniqueNames = Array.from(new Set(preparedData.map((item) => item.name)));
    if (uniqueNames.length === 0) {
      setResolvedLogoUrls({});
      return;
    }

    let cancelled = false;

    const resolveAll = async () => {
      const entries = await Promise.all(
        uniqueNames.map(async (name) => {
          const resolved = await loadFirstAvailableLogo(getLogoCandidates(name));
          return [name, resolved] as const;
        })
      );

      if (cancelled) return;

      const nextMap: Record<string, string> = {};
      entries.forEach(([name, resolved]) => {
        if (resolved) nextMap[name] = resolved;
      });
      setResolvedLogoUrls(nextMap);
    };

    resolveAll();

    return () => {
      cancelled = true;
    };
  }, [preparedData, showLogos]);

  // Desktop: pre-calculate non-overlapping label positions in two clean columns.
  const layout = useMemo(() => {
    if (isMobile || total === 0) return {};

    let currentAngle = 90;
    const rightLabels: LabelLayoutItem[] = [];
    const leftLabels: LabelLayoutItem[] = [];

    const items = preparedData
      .map((item, index) => {
        const sliceAngle = (item.value / total) * 360;
        const midAngle = currentAngle - sliceAngle / 2;
        currentAngle -= sliceAngle;

        if (item.pct < MIN_OUTER_LABEL_PCT) return null;

        const rad = Math.PI / 180;
        const xRaw = Math.cos(midAngle * rad);
        const yRaw = -Math.sin(midAngle * rad);
        const isRight = xRaw >= 0;
        // Ideal Y: project the midAngle out to label distance for initial placement
        const labelRadius = DESKTOP_OUTER_RADIUS + 40;
        const idealY = DESKTOP_CHART_CENTER_Y + yRaw * labelRadius;

        const labelItem: LabelLayoutItem = {
          name: item.name,
          index,
          value: item.value,
          pct: item.pct,
          color: item.color,
          isRight,
          midAngleDeg: midAngle,
          y: idealY,
          finalX: isRight ? DESKTOP_LABEL_X_RIGHT : DESKTOP_LABEL_X_LEFT,
          textAnchor: isRight ? "start" : "end",
        };

        if (isRight) rightLabels.push(labelItem);
        else leftLabels.push(labelItem);
        return labelItem;
      })
      .filter(Boolean) as LabelLayoutItem[];

    // Relax: prevent vertical overlap
    const relax = (labels: LabelLayoutItem[]) => {
      if (labels.length === 0) return;
      labels.sort((a, b) => a.y - b.y);

      // Center the group vertically around the chart center
      const totalHeight = (labels.length - 1) * DESKTOP_LABEL_MIN_SPACING;
      const idealStart = DESKTOP_CHART_CENTER_Y - totalHeight / 2;
      const clampedStart = Math.max(DESKTOP_LABEL_MIN_Y, Math.min(idealStart, DESKTOP_LABEL_MAX_Y - totalHeight));

      // First pass: spread evenly from clamped start
      for (let i = 0; i < labels.length; i++) {
        const evenY = clampedStart + i * DESKTOP_LABEL_MIN_SPACING;
        // Blend between ideal radial Y and even distribution (70% even, 30% radial)
        labels[i].y = evenY * 0.7 + labels[i].y * 0.3;
      }

      // Second pass: enforce minimum spacing
      labels[0].y = Math.max(labels[0].y, DESKTOP_LABEL_MIN_Y);
      for (let i = 1; i < labels.length; i++) {
        labels[i].y = Math.max(labels[i].y, labels[i - 1].y + DESKTOP_LABEL_MIN_SPACING);
      }

      // Push up if overflowing bottom
      const overflow = labels[labels.length - 1].y - DESKTOP_LABEL_MAX_Y;
      if (overflow > 0) {
        labels[labels.length - 1].y -= overflow;
        for (let i = labels.length - 2; i >= 0; i--) {
          labels[i].y = Math.min(labels[i].y, labels[i + 1].y - DESKTOP_LABEL_MIN_SPACING);
        }
        if (labels[0].y < DESKTOP_LABEL_MIN_Y) {
          const underflow = DESKTOP_LABEL_MIN_Y - labels[0].y;
          labels.forEach((l) => { l.y += underflow; });
        }
      }
    };

    relax(rightLabels);
    relax(leftLabels);

    const map: Record<string, LabelLayoutItem> = {};
    items.forEach((item) => {
      map[`${item.name}-${item.index}`] = item;
    });
    return map;
  }, [isMobile, preparedData, total]);

  // Custom slice renderer (without logo watermark inside slices).
  const renderActiveShape = useCallback((props: any) => {
    const {
      cx, cy, innerRadius, outerRadius, startAngle, endAngle,
      fill, payload,
    } = props;

    const item = payload as PreparedAllocationItem;
    const dark = isVeryDarkColor(item.color);
    const sliceStroke = dark ? "rgba(248, 250, 252, 0.55)" : "hsl(var(--background))";
    const sliceStrokeWidth = dark ? 1.8 : 1.4;

    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        cornerRadius={6}
        stroke={sliceStroke}
        strokeWidth={sliceStrokeWidth}
      />
    );
  }, []);

  if (preparedData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          {allocationMode && onAllocationModeChange && (
            <div className="flex justify-end">
              <ToggleGroup
                type="single"
                value={allocationMode}
                onValueChange={(v) => {
                  if (v === "account" || v === "asset") onAllocationModeChange(v);
                }}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <ToggleGroupItem value="account" aria-label="Par compte">
                  Par compte
                </ToggleGroupItem>
                <ToggleGroupItem value="asset" aria-label="Par actif">
                  Par actif
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          Aucune donnée
        </CardContent>
      </Card>
    );
  }

  const renderCustomizedLabel = (props: PieLabelProps) => {
    const { cx, cy, name, outerRadius, midAngle, index } = props;
    if (
      typeof cx !== "number" ||
      typeof cy !== "number" ||
      typeof name !== "string" ||
      typeof outerRadius !== "number" ||
      typeof midAngle !== "number" ||
      typeof index !== "number"
    ) {
      return null;
    }

    const item = layout[`${name}-${index}`];
    if (!item) return null;

    const yDelta = item.y - DESKTOP_CHART_CENTER_Y;
    const finalY = cy + yDelta;
    const finalX = cx + item.finalX;

    const rad = Math.PI / 180;
    // Start point: on the outer edge of the slice
    const sx = cx + outerRadius * Math.cos(-midAngle * rad);
    const sy = cy + outerRadius * Math.sin(-midAngle * rad);
    // Elbow point: extend radially outward from the slice
    const elbowLen = 12;
    const ex = cx + (outerRadius + elbowLen) * Math.cos(-midAngle * rad);
    const ey = cy + (outerRadius + elbowLen) * Math.sin(-midAngle * rad);

    const dark = isVeryDarkColor(item.color);
    const connectorColor = dark ? "rgba(248, 250, 252, 0.7)" : withAlpha(item.color, 0.55);
    const dotColor = dark ? "rgba(248, 250, 252, 0.95)" : item.color;

    const logoUrl = showLogos ? (resolvedLogoUrls[name] ?? null) : null;
    const isGtt = isGttTicker(name);
    const logoSize = isGtt ? 20 : 22;
    const logoOffsetY = isGtt ? -1.2 : 0;
    const logoPreserve = isGtt ? "xMidYMid meet" : "xMidYMid slice";
    const logoCenterX = item.isRight ? finalX + 18 : finalX - 18;
    const imageX = logoCenterX - logoSize / 2;
    const clipId = `allocation-logo-clip-${index}`;
    const logoCircleBg = dark ? "rgba(40, 40, 48, 0.95)" : "rgba(255, 255, 255, 0.95)";
    const logoCircleBorder = dark ? "rgba(248, 250, 252, 0.5)" : withAlpha(item.color, 0.35);
    const textX = item.isRight
      ? (logoUrl ? finalX + 36 : finalX + 10)
      : (logoUrl ? finalX - 36 : finalX - 10);

    const ringMidRadius = (DESKTOP_INNER_RADIUS + DESKTOP_OUTER_RADIUS) / 2;
    const insideX = cx + ringMidRadius * Math.cos(-midAngle * rad);
    const insideY = cy + ringMidRadius * Math.sin(-midAngle * rad);

    return (
      <g>
        {/* Connector: slice edge → radial elbow → horizontal to label */}
        <path
          d={`M${sx},${sy} L${ex},${ey} L${finalX},${finalY}`}
          stroke={connectorColor}
          fill="none"
          strokeWidth={1.1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {logoUrl && (
          <>
            <circle
              cx={logoCenterX}
              cy={finalY}
              r={logoSize / 2 + 1}
              fill={logoCircleBg}
              stroke={logoCircleBorder}
              strokeWidth={1}
            />
            <clipPath id={clipId}>
              <circle cx={logoCenterX} cy={finalY} r={logoSize / 2} />
            </clipPath>
            <image
              x={imageX}
              y={finalY - logoSize / 2 + logoOffsetY}
              width={logoSize}
              height={logoSize}
              href={logoUrl}
              clipPath={`url(#${clipId})`}
              preserveAspectRatio={logoPreserve}
            />
          </>
        )}
        {!logoUrl && <circle cx={finalX} cy={finalY} r={2.5} fill={dotColor} />}
        <text
          x={textX}
          y={finalY}
          textAnchor={item.textAnchor}
          dominantBaseline="central"
          className="font-semibold tracking-[0.01em]"
          style={{ fontSize: "12.5px", fill: "hsl(var(--foreground))" }}
        >
          {getDisplayLabel(name)}
        </text>
        {item.pct >= MIN_INSIDE_PCT_LABEL && (
          <text
            x={insideX}
            y={insideY}
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontSize: "13px", fontWeight: 700, fill: getContrastTextColor(item.color) }}
          >
            {`${item.pct.toFixed(1).replace(".", ",")}%`}
          </text>
        )}
      </g>
    );
  };

  const CustomTooltip = ({ active, payload }: AllocationTooltipProps) => {
    if (!active || !payload?.[0]) return null;
    const dataPoint = payload[0].payload;
    const pct = total > 0 ? ((dataPoint.value / total) * 100).toFixed(1) : "0";

    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs">
        <div className="mb-1 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{
            backgroundColor: dataPoint.color,
            border: isVeryDarkColor(dataPoint.color) ? "1px solid rgba(248, 250, 252, 0.85)" : "none",
          }} />
          <p className="font-semibold text-foreground">{dataPoint.name}</p>
        </div>
        <p className="text-muted-foreground">
          {hideAmounts ? "••••••" : formatCurrency(dataPoint.value)} · {pct.replace(".", ",")}%
        </p>
      </div>
    );
  };

  if (isMobile) {
    return (
      <Card className="col-span-1">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xl font-bold">{title}</CardTitle>
          {allocationMode && onAllocationModeChange && (
            <div className="flex justify-end">
              <ToggleGroup
                type="single"
                value={allocationMode}
                onValueChange={(v) => {
                  if (v === "account" || v === "asset") onAllocationModeChange(v);
                }}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <ToggleGroupItem value="account" aria-label="Par compte">
                  Par compte
                </ToggleGroupItem>
                <ToggleGroupItem value="asset" aria-label="Par actif">
                  Par actif
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={preparedData}
                  cx="50%"
                  cy="50%"
                  startAngle={90}
                  endAngle={-270}
                  innerRadius={44}
                  outerRadius={84}
                  paddingAngle={1.4}
                  cornerRadius={4}
                  dataKey="value"
                  stroke="hsl(var(--background))"
                  strokeWidth={1.25}
                  label={false}
                  labelLine={false}
                  isAnimationActive
                  animationDuration={850}
                >
                  {preparedData.map((item, i) => (
                    <Cell
                      key={item.name + i}
                      fill={item.color}
                      stroke={isVeryDarkColor(item.color) ? "rgba(248, 250, 252, 0.5)" : "hsl(var(--background))"}
                      strokeWidth={isVeryDarkColor(item.color) ? 1.6 : 1.25}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {preparedData.map((item, i) => {
              const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
              return (
                <div key={item.name + i} className="flex min-w-0 items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{
                    backgroundColor: item.color,
                    border: isVeryDarkColor(item.color) ? "1px solid rgba(248, 250, 252, 0.8)" : "none",
                  }} />
                  <span className="truncate font-medium text-foreground">{item.name}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{pct.replace(".", ",")}%</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-1 flex flex-col h-[480px]">
      <CardHeader className="pb-0 flex-none flex flex-row items-center justify-between">
        <CardTitle className="text-xl font-bold hidden">{title}</CardTitle>
        {allocationMode && onAllocationModeChange && (
          <div className="flex justify-end w-full">
            <ToggleGroup
              type="single"
              value={allocationMode}
              onValueChange={(v) => {
                if (v === "account" || v === "asset") onAllocationModeChange(v);
              }}
              variant="outline"
              size="sm"
              className="gap-1"
            >
              <ToggleGroupItem value="account" aria-label="Par compte">
                Par compte
              </ToggleGroupItem>
              <ToggleGroupItem value="asset" aria-label="Par actif">
                Par actif
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
      </CardHeader>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 10, right: 24, bottom: 10, left: 24 }}>
            <Pie
              data={preparedData}
              cx="50%"
              cy="50%"
              startAngle={90}
              endAngle={-270}
              innerRadius={DESKTOP_INNER_RADIUS}
              outerRadius={DESKTOP_OUTER_RADIUS}
              paddingAngle={1.6}
              cornerRadius={6}
              dataKey="value"
              stroke="hsl(var(--background))"
              strokeWidth={1.4}
              label={renderCustomizedLabel}
              labelLine={false}
              isAnimationActive
              animationDuration={950}
              activeIndex={preparedData.map((_, i) => i)}
              activeShape={renderActiveShape}
            >
              {preparedData.map((item, i) => (
                <Cell
                  key={item.name + i}
                  fill={item.color}
                  stroke={isVeryDarkColor(item.color) ? "rgba(248, 250, 252, 0.55)" : "hsl(var(--background))"}
                  strokeWidth={isVeryDarkColor(item.color) ? 1.8 : 1.4}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
