
CREATE TABLE public.earnings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL,
  quarter TEXT NOT NULL,
  revenue_growth NUMERIC,
  operating_margin NUMERIC,
  roe NUMERIC,
  debt_ebitda NUMERIC,
  moat BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'hold',
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to earnings"
ON public.earnings
FOR ALL
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_earnings_updated_at
BEFORE UPDATE ON public.earnings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
