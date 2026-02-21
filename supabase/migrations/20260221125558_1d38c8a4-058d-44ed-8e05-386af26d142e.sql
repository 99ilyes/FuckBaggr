ALTER TABLE public.transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check CHECK (type = ANY (ARRAY['buy', 'sell', 'deposit', 'withdrawal', 'conversion', 'dividend', 'interest', 'coupon']));
