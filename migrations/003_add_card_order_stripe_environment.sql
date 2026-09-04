ALTER TABLE pedidos_tarjetas
ADD COLUMN stripe_entorno TEXT NOT NULL DEFAULT 'test'
CHECK (stripe_entorno IN ('test', 'live'));
