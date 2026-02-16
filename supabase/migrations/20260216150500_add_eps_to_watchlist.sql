-- Add eps column to watchlist_valuations for user-provided EPS
ALTER TABLE public.watchlist_valuations ADD COLUMN IF NOT EXISTS eps NUMERIC DEFAULT NULL;
