
-- Add currency to portfolios (base currency chosen at creation)
ALTER TABLE public.portfolios ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR';

-- Add currency to transactions (for cash operations)
ALTER TABLE public.transactions ADD COLUMN currency TEXT DEFAULT 'EUR';
