import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import yahooFinance from "https://esm.sh/yahoo-finance2@2.3.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: corsHeaders }); }

    let { tickers, mode } = body;
    // Parsing robuste pour body stringifié
    if (typeof body === "string") { try { const p = JSON.parse(body); tickers = p.tickers; mode = p.mode; } catch {} }
    if (!tickers && body.body) { let i = body.body; if (typeof i === "string") { try { i = JSON.parse(i); } catch {} } if (i.tickers) { tickers = i.tickers; mode = i.mode; } }

    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ error: "tickers array required", debugBody: body }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- MODE: FUNDAMENTALS ---
    if (mode === "fundamentals") {
      const results: Record<string, any> = {};
      try {
        const uniqueTickers = [...new Set(tickers)];
        const quotes = await yahooFinance.quote(uniqueTickers, { validateResult: false });
        for (const q of quotes) {
          results[q.symbol] = {
            trailingEps: q.epsTrailingTwelveMonths ?? null,
            forwardEps: q.epsForward ?? null,
            trailingPE: q.trailingPE ?? q.peRatio ?? null,
            forwardPE: q.forwardPE ?? null,
            currentPrice: q.regularMarketPrice ?? null,
            currency: q.currency ?? "USD",
            name: q.shortName ?? q.longName ?? q.symbol,
            sector: (q as any).sector ?? null,
            industry: (q as any).industry ?? null,
          };
        }
        uniqueTickers.forEach(t => { if (!results[t]) results[t] = { error: "Not found" }; });
      } catch (err) {
        console.error("Error fetching fundamentals:", err);
        tickers.forEach(t => { if (!results[t]) results[t] = { error: String(err) }; });
      }
      return new Response(JSON.stringify({ results, debugMode: mode, source: "yahoo-finance2" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    // ... [MODE DEFAULT: code inchangé plus bas] ...
    // Le reste du fichier gère le mode historique et default (prix)
    // Assure-toi de copier TOUT le fichier depuis ton éditeur.
