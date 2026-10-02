-- Pendiente de aplicar. Requiere 002, 003 y 004. No modifica datos históricos.
CREATE TABLE card_artwork (
  token TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('ready', 'review')),
  warnings_json TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  order_id TEXT REFERENCES pedidos_tarjetas(id) ON DELETE RESTRICT,
  inquiry_id TEXT REFERENCES consultas_tarjetas(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK (order_id IS NULL OR inquiry_id IS NULL)
);
CREATE INDEX idx_card_artwork_order ON card_artwork(order_id);
CREATE INDEX idx_card_artwork_inquiry ON card_artwork(inquiry_id);
CREATE INDEX idx_card_artwork_owner ON card_artwork(owner_hash, created_at);
