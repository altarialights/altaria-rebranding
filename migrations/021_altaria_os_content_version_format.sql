-- Congela el formato editorial en cada snapshot de contenido.
-- 019 y 020 permanecen inmutables; TEST no contiene piezas persistentes al aplicar 021.
ALTER TABLE content_piece_versions ADD COLUMN format_snapshot TEXT NOT NULL DEFAULT '';
