#!/usr/bin/env python3
"""
Petit serveur HTTP local qui utilise yfinance pour exposer les ratios PE.
Usage:  python3 scripts/yfinance_server.py
Écoute sur http://localhost:5001
"""

import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import yfinance as yf


class YFinanceHandler(BaseHTTPRequestHandler):
    """Handle GET /pe?tickers=AAPL,MC.PA,..."""

    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(204)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/pe":
            self._handle_pe(parsed)
        elif parsed.path == "/search":
            self._handle_search(parsed)
        elif parsed.path == "/health":
            self._set_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "not found"}).encode())

    def _handle_search(self, parsed):
        qs = parse_qs(parsed.query)
        query = qs.get("q", [""])[0].strip()
        if not query:
            self._set_headers(400)
            self.wfile.write(json.dumps({"error": "missing q param"}).encode())
            return

        try:
            import urllib.request
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            search_url = f"https://query2.finance.yahoo.com/v1/finance/search?q={query}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query"
            req = urllib.request.Request(search_url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=5, context=ctx) as resp:
                data = json.loads(resp.read().decode())
            
            results = []
            for quote in data.get("quotes", []):
                results.append({
                    "symbol": quote.get("symbol", ""),
                    "name": quote.get("longname") or quote.get("shortname", ""),
                    "exchange": quote.get("exchDisp", ""),
                    "type": quote.get("quoteType", ""),
                })
            
            self._set_headers()
            self.wfile.write(json.dumps(results).encode())
        except Exception as e:
            print(f"[yfinance] Search error: {e}", file=sys.stderr)
            self._set_headers(500)
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _handle_pe(self, parsed):
        qs = parse_qs(parsed.query)
        raw = qs.get("tickers", [""])[0]
        tickers = [t.strip() for t in raw.split(",") if t.strip()]

        if not tickers:
            self._set_headers(400)
            self.wfile.write(json.dumps({"error": "missing tickers param"}).encode())
            return

        result = {}
        for t in tickers:
            try:
                info = yf.Ticker(t).info
                trailing = info.get("trailingPE")
                forward = info.get("forwardPE")
                trailing_eps = info.get("trailingEps")
                forward_eps = info.get("forwardEps")
                result[t] = {
                    "trailingPE": trailing if isinstance(trailing, (int, float)) else None,
                    "forwardPE": forward if isinstance(forward, (int, float)) else None,
                    "trailingEps": trailing_eps if isinstance(trailing_eps, (int, float)) else None,
                    "forwardEps": forward_eps if isinstance(forward_eps, (int, float)) else None,
                }
            except Exception as e:
                print(f"[yfinance] Error fetching {t}: {e}", file=sys.stderr)
                result[t] = {"trailingPE": None, "forwardPE": None, "trailingEps": None, "forwardEps": None}

        self._set_headers()
        self.wfile.write(json.dumps(result).encode())

    def log_message(self, format, *args):
        print(f"[yfinance-server] {args[0]}", file=sys.stderr)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    server = HTTPServer(("127.0.0.1", port), YFinanceHandler)
    print(f"🐍 yfinance server running on http://localhost:{port}")
    print(f"   Example: http://localhost:{port}/pe?tickers=AAPL,MC.PA")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
