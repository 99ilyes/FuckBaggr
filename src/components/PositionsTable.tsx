import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AssetPosition, formatCurrency, formatPercent } from "@/lib/calculations";
import { ArrowUpDown } from "lucide-react";

// Ticker → company website domain for logo fetching
const TICKER_DOMAINS: Record<string, string> = {
  // US Tech
  NVDA: "nvidia.com", GOOG: "google.com", GOOGL: "google.com",
  AAPL: "apple.com", MSFT: "microsoft.com", AMZN: "amazon.com",
  META: "meta.com", TSLA: "tesla.com", NFLX: "netflix.com",
  AMD: "amd.com", INTC: "intel.com", CRM: "salesforce.com",
  ADBE: "adobe.com", ORCL: "oracle.com", CSCO: "cisco.com",
  AVGO: "broadcom.com", QCOM: "qualcomm.com", IBM: "ibm.com",
  PYPL: "paypal.com", SHOP: "shopify.com", UBER: "uber.com",
  ABNB: "airbnb.com", COIN: "coinbase.com", SQ: "squareup.com",
  PLTR: "palantir.com", SNOW: "snowflake.com", SPOT: "spotify.com",
  // US Finance
  NU: "nubank.com.br", JPM: "jpmorganchase.com", V: "visa.com",
  MA: "mastercard.com", GS: "goldmansachs.com", BAC: "bankofamerica.com",
  MS: "morganstanley.com", "BRK-B": "berkshirehathaway.com",
  // Semiconductors
  TSM: "tsmc.com",
  // ETFs & Commodities
  "GOLD-EUR.PA": "amundietf.com", GLD: "spdrgoldshares.com",
  "B28A.PA": "blackrock.com",
  SPY: "ssga.com", QQQ: "invesco.com", VTI: "vanguard.com", VOO: "vanguard.com",
  // Japanese
  "6857.T": "advantest.com", "7203.T": "toyota.com",
  "6758.T": "sony.com", "9984.T": "softbank.com",
  // French
  "AI.PA": "airliquide.com",
  "MC.PA": "lvmh.com", "OR.PA": "loreal.com",
  "SAN.PA": "sanofi.com", "BNP.PA": "group.bnpparibas",
  "SU.PA": "se.com", "CAP.PA": "capgemini.com",
  "RMS.PA": "hermes.com", "TTE.PA": "totalenergies.com",
  "GTT.PA": "gtt.fr",
  // European
  "RACE.MI": "ferrari.com", "ADYEN.AS": "adyen.com",
  "ASML.AS": "asml.com",
  // Latam
  MELI: "mercadolibre.com",
  // Other US
  NBIS: "nebius.com",
  GEV: "gevernova.com",
  LITE: "lumentum.com",
};

function getLogoDomain(ticker: string): string | null {
  if (TICKER_DOMAINS[ticker]) return TICKER_DOMAINS[ticker];
  const base = ticker.split(".")[0];
  if (TICKER_DOMAINS[base]) return TICKER_DOMAINS[base];
  return null;
}

function TickerLogo({ ticker }: { ticker: string }) {
  const [failed, setFailed] = useState(false);
  const domain = getLogoDomain(ticker);

  if (!domain || failed) {
    // Fallback: colored initial letter
    const letter = ticker.charAt(0).toUpperCase();
    const hue = ticker.split("").reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
    return (
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0"
        style={{ backgroundColor: `hsl(${hue}, 50%, 40%)` }}
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
      alt={ticker}
      className="w-7 h-7 rounded-md object-contain shrink-0 p-0.5 bg-white/90"
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

interface Props {
  positions: AssetPosition[];
  baseCurrency?: string;
}

type SortKey = "ticker" | "quantity" | "currentPrice" | "currentValueBase" | "gainLossPercent" | "pru" | "currentValue";

interface SortConfig {
  key: SortKey;
  direction: "asc" | "desc";
}

export function PositionsTable({ positions, baseCurrency = "EUR" }: Props) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: "currentValueBase", direction: "desc" });

  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Aucune position. Ajoutez des transactions pour commencer.
      </div>
    );
  }

  const sortedPositions = [...positions].sort((a, b) => {
    const aValue = a[sortConfig.key as keyof AssetPosition];
    const bValue = b[sortConfig.key as keyof AssetPosition];
    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortConfig.direction === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }
    if (typeof aValue === "number" && typeof bValue === "number") {
      return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
    }
    return 0;
  });

  const handleSort = (key: SortKey) => {
    setSortConfig((c) => ({
      key,
      direction: c.key === key && c.direction === "asc" ? "desc" : "asc",
    }));
  };

  const SortHeader = ({ label, keyName, className = "" }: { label: string; keyName: SortKey; className?: string }) => (
    <TableHead className={className}>
      <button
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => handleSort(keyName)}
      >
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      </button>
    </TableHead>
  );

  const total = sortedPositions.reduce((s, p) => s + (p.currentValueBase ?? p.currentValue), 0);

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border/30 hover:bg-transparent">
          <SortHeader label="Actif" keyName="ticker" />
          <SortHeader label="Qté" keyName="quantity" className="text-right" />
          <SortHeader label="PRU" keyName="pru" className="text-right" />
          <SortHeader label="Prix" keyName="currentPrice" className="text-right" />
          <SortHeader label="Val. Devise" keyName="currentValue" className="text-right" />
          <SortHeader label="Valeur" keyName="currentValueBase" className="text-right" />
          <SortHeader label="P&L" keyName="gainLossPercent" className="text-right" />
          <TableHead className="text-right text-xs text-muted-foreground">Poids</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedPositions.map((pos) => {
          const weight = total > 0 ? ((pos.currentValueBase ?? pos.currentValue) / total * 100).toFixed(1) : "0";
          return (
            <TableRow key={pos.ticker} className="border-border/20 hover:bg-muted/30">
              <TableCell className="py-2.5">
                <div className="flex items-center gap-2.5">
                  <TickerLogo ticker={pos.ticker} />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-sm">{pos.ticker}</span>
                    {pos.name && pos.name !== pos.ticker && (
                      <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">{pos.name}</span>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm py-2.5">
                {pos.quantity % 1 === 0 ? pos.quantity : pos.quantity.toFixed(2)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm py-2.5 text-muted-foreground">
                {formatCurrency(pos.pru, pos.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm py-2.5">
                {formatCurrency(pos.currentPrice, pos.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm py-2.5 text-muted-foreground">
                {formatCurrency(pos.currentValue, pos.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm font-medium py-2.5">
                {formatCurrency(pos.currentValueBase, baseCurrency)}
              </TableCell>
              <TableCell className="text-right py-2.5">
                <div className={`text-sm font-medium tabular-nums ${pos.gainLossPercent >= 0 ? "text-gain" : "text-loss"}`}>
                  {formatPercent(pos.gainLossPercent)}
                </div>
                <div className={`text-[11px] tabular-nums ${pos.gainLossBase >= 0 ? "text-gain/60" : "text-loss/60"}`}>
                  {formatCurrency(pos.gainLossBase, baseCurrency)}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm text-muted-foreground py-2.5">
                {weight}%
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

