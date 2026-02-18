
CREATE TABLE public.calculator_settings (
  id TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  loan_amount NUMERIC,
  loan_start_date TEXT,
  insurance_amount NUMERIC,
  investment_return_rate NUMERIC,
  repayment_start_date TEXT,
  custom_payments JSONB,
  repayment_duration_years NUMERIC,
  loan_interest_rate_repayment NUMERIC,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.calculator_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to calculator_settings"
  ON public.calculator_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);
