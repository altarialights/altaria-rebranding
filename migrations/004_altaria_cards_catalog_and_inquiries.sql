-- Append-only: los pedidos históricos mantienen su producto e importes.
ALTER TABLE pedidos_tarjetas ADD COLUMN producto_id TEXT NOT NULL DEFAULT 'resenas';
ALTER TABLE pedidos_tarjetas ADD COLUMN producto_nombre TEXT NOT NULL DEFAULT 'Tarjeta NFC + QR para reseñas de Google';
ALTER TABLE pedidos_tarjetas ADD COLUMN personalizacion_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE consultas_tarjetas (
  id TEXT PRIMARY KEY,
  clave_idempotencia TEXT NOT NULL UNIQUE,
  huella_solicitud TEXT NOT NULL,
  producto_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  contacto TEXT NOT NULL,
  negocio TEXT,
  cantidad INTEGER CHECK (cantidad IS NULL OR cantidad BETWEEN 1 AND 500),
  idea TEXT NOT NULL,
  configuracion_json TEXT NOT NULL DEFAULT '{}',
  privacidad_aceptada_en TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva', 'contactada', 'cerrada')),
  creado_en TEXT NOT NULL
);
CREATE INDEX idx_consultas_tarjetas_estado_fecha ON consultas_tarjetas(estado, creado_en DESC);
