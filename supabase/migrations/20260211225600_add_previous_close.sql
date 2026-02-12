-- Add previous_close to assets_cache for daily performance calculation
ALTER TABLE public.assets_cache ADD COLUMN IF NOT EXISTS previous_close NUMERIC DEFAULT NULL;
