-- Create watchlist_valuations table for fair price calculation parameters
CREATE TABLE IF NOT EXISTS public.watchlist_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT UNIQUE NOT NULL,
  eps_growth NUMERIC DEFAULT 0.10,
  terminal_pe NUMERIC DEFAULT 15,
  min_return NUMERIC DEFAULT 0.12,
  years INTEGER DEFAULT 5,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.watchlist_valuations ENABLE ROW LEVEL SECURITY;

-- Allow all operations (single-user app)
CREATE POLICY "Allow all on watchlist_valuations" ON public.watchlist_valuations
  FOR ALL USING (true) WITH CHECK (true);
