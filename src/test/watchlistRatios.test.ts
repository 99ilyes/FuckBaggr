import { describe, expect, it } from "vitest";
import {
  buildRatioSeries,
  computeStats,
  FundamentalsHistorySnapshot,
  RatioPricePoint,
} from "@/lib/watchlistRatios";

function toSec(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

describe("watchlistRatios", () => {
  it("applique le carry-forward des snapshots sur les prix journaliers", () => {
    const prices: RatioPricePoint[] = [
      { time: toSec("2024-01-01"), price: 100 },
      { time: toSec("2024-01-02"), price: 102 },
      { time: toSec("2024-01-03"), price: 110 },
      { time: toSec("2024-01-04"), price: 112 },
    ];

    const snapshots: FundamentalsHistorySnapshot[] = [
      {
        asOfDate: "2024-01-01",
        trailingPeRatio: 20,
        trailingEps: 5,
        trailingFreeCashFlow: 200,
        trailingTotalRevenue: 400,
        trailingShares: 50,
      },
      {
        asOfDate: "2024-01-03",
        trailingPeRatio: 25,
        trailingEps: 4.4,
        trailingFreeCashFlow: 220,
        trailingTotalRevenue: 440,
        trailingShares: 50,
      },
    ];

    const result = buildRatioSeries(prices, snapshots);

    expect(result.peSeries).toHaveLength(4);
    expect(result.peSeries.map((point) => point.value)).toEqual([20, 20, 25, 25]);

    expect(result.pfcfSeries[0].value).toBeCloseTo(25, 6);
    expect(result.pfcfSeries[1].value).toBeCloseTo(25.5, 6);
    expect(result.pfcfSeries[2].value).toBeCloseTo(25, 6);
    expect(result.pfcfSeries[3].value).toBeCloseTo(25.454545, 6);

    expect(result.psSeries[0].value).toBeCloseTo(12.5, 6);
    expect(result.psSeries[3].value).toBeCloseTo(12.727272, 5);
  });

  it("utilise le fallback price/eps quand trailingPeRatio est absent", () => {
    const prices: RatioPricePoint[] = [
      { time: toSec("2024-02-01"), price: 80 },
      { time: toSec("2024-02-02"), price: 84 },
    ];

    const snapshots: FundamentalsHistorySnapshot[] = [
      {
        asOfDate: "2024-02-01",
        trailingPeRatio: null,
        trailingEps: 4,
        trailingFreeCashFlow: 100,
        trailingTotalRevenue: 200,
        trailingShares: 10,
      },
    ];

    const result = buildRatioSeries(prices, snapshots);

    expect(result.peSeries).toHaveLength(2);
    expect(result.peSeries[0].value).toBeCloseTo(20, 6);
    expect(result.peSeries[1].value).toBeCloseTo(21, 6);
  });

  it("exclut les points invalides quand les denominateurs sont <= 0", () => {
    const prices: RatioPricePoint[] = [{ time: toSec("2024-03-01"), price: 90 }];

    const snapshots: FundamentalsHistorySnapshot[] = [
      {
        asOfDate: "2024-03-01",
        trailingPeRatio: null,
        trailingEps: -2,
        trailingFreeCashFlow: 0,
        trailingTotalRevenue: -120,
        trailingShares: 40,
      },
    ];

    const result = buildRatioSeries(prices, snapshots);

    expect(result.peSeries).toHaveLength(0);
    expect(result.pfcfSeries).toHaveLength(0);
    expect(result.psSeries).toHaveLength(0);
  });

  it("calcule correctement high/median/low", () => {
    const stats = computeStats([
      { time: 1, value: 10 },
      { time: 2, value: 30 },
      { time: 3, value: 20 },
      { time: 4, value: 40 },
    ]);

    expect(stats.high).toBe(40);
    expect(stats.median).toBe(25);
    expect(stats.low).toBe(10);
  });
});
