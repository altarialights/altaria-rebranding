PRAGMA foreign_keys = ON;

CREATE TABLE pedidos_tarjetas (
  id TEXT PRIMARY KEY,
  numero_pedido TEXT NOT NULL UNIQUE,
  clave_idempotencia TEXT NOT NULL UNIQUE,
  huella_solicitud TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente_pago' CHECK (
    estado IN ('pendiente_pago', 'pagado', 'preparando', 'enviado', 'entregado', 'cancelado', 'reembolsado')
  ),
  google_place_id TEXT NOT NULL,
  negocio_nombre TEXT NOT NULL,
  negocio_direccion TEXT NOT NULL,
  google_maps_url TEXT,
  cantidad INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 500),
  precio_unitario_centimos INTEGER NOT NULL CHECK (precio_unitario_centimos >= 0),
  subtotal_centimos INTEGER NOT NULL CHECK (subtotal_centimos >= 0),
  envio_centimos INTEGER NOT NULL CHECK (envio_centimos >= 0),
  impuestos_centimos INTEGER NOT NULL DEFAULT 0 CHECK (impuestos_centimos >= 0),
  total_centimos INTEGER NOT NULL CHECK (total_centimos >= 0),
  moneda TEXT NOT NULL DEFAULT 'eur' CHECK (moneda = 'eur'),
  cliente_nombre TEXT NOT NULL,
  cliente_email TEXT NOT NULL,
  cliente_telefono TEXT NOT NULL,
  envio_direccion TEXT NOT NULL,
  envio_direccion_extra TEXT,
  envio_codigo_postal TEXT NOT NULL,
  envio_ciudad TEXT NOT NULL,
  envio_provincia TEXT NOT NULL,
  envio_pais TEXT NOT NULL DEFAULT 'ES' CHECK (envio_pais = 'ES'),
  referencia_envio TEXT,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  creado_en TEXT NOT NULL,
  pagado_en TEXT,
  preparado_en TEXT,
  enviado_en TEXT,
  entregado_en TEXT,
  cancelado_en TEXT,
  reembolsado_en TEXT,
  tracking TEXT,
  transportista TEXT,
  telegram_notificado_en TEXT,
  telegram_ultimo_error TEXT
);

CREATE TABLE eventos_pedido (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL,
  tipo_evento TEXT NOT NULL,
  estado_anterior TEXT,
  estado_nuevo TEXT,
  datos_minimos_json TEXT NOT NULL DEFAULT '{}',
  clave_idempotencia TEXT UNIQUE,
  creado_en TEXT NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos_tarjetas(id) ON DELETE CASCADE
);

CREATE TABLE eventos_stripe (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  pedido_id TEXT,
  tipo TEXT NOT NULL,
  resultado TEXT NOT NULL CHECK (
    resultado IN ('procesado', 'duplicado_estado', 'pago_pendiente', 'importe_incorrecto', 'moneda_incorrecta', 'metadata_incorrecta', 'pedido_no_encontrado')
  ),
  datos_minimos_json TEXT NOT NULL DEFAULT '{}',
  procesado_en TEXT NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos_tarjetas(id) ON DELETE SET NULL
);

CREATE INDEX idx_pedidos_tarjetas_estado ON pedidos_tarjetas(estado, creado_en DESC);
CREATE INDEX idx_pedidos_tarjetas_creado_en ON pedidos_tarjetas(creado_en DESC);
CREATE INDEX idx_pedidos_tarjetas_numero ON pedidos_tarjetas(numero_pedido);
CREATE INDEX idx_pedidos_tarjetas_checkout ON pedidos_tarjetas(stripe_checkout_session_id);
CREATE INDEX idx_pedidos_tarjetas_payment_intent ON pedidos_tarjetas(stripe_payment_intent_id);
CREATE INDEX idx_eventos_pedido_timeline ON eventos_pedido(pedido_id, creado_en DESC);
CREATE INDEX idx_eventos_stripe_pedido ON eventos_stripe(pedido_id, procesado_en DESC);
