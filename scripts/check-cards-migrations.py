"""Offline audit only: disposable in-memory SQLite. Never opens Turso or .env."""
import sqlite3
from pathlib import Path

def statements(filename):
    text = Path('migrations', filename).read_text(encoding='utf-8-sig')
    return [part.strip() for part in text.split(';') if part.strip()]

db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for name in ['001_create_digital_assessment.sql', '002_create_card_orders.sql', '003_add_card_order_stripe_environment.sql']:
    db.executescript(Path('migrations', name).read_text(encoding='utf-8-sig'))
columns = db.execute('PRAGMA table_info(pedidos_tarjetas)').fetchall()
old = {name: (1 if kind == 'INTEGER' else 'legacy') for _, name, kind, required, default, pk in columns if (required or pk) and default is None}
old.update(id='legacy-order', cantidad=17, precio_unitario_centimos=1750, subtotal_centimos=29750, envio_centimos=0, impuestos_centimos=0, total_centimos=29750)
db.execute(f"INSERT INTO pedidos_tarjetas ({','.join(old)}) VALUES ({','.join('?' for _ in old)})", list(old.values()))
db.commit()
baseline = db.execute('SELECT * FROM pedidos_tarjetas').fetchone()
names = [item[1] for item in columns]
four = statements('004_altaria_cards_catalog_and_inquiries.sql')
five = statements('005_card_artwork.sql')

# Failure midway rolls back both DDL and changes, preserving the old order.
db.execute('BEGIN IMMEDIATE')
try:
    for sql in four + five[:2]: db.execute(sql)
    db.execute('INSERT INTO nonexistent_table VALUES (1)')
except sqlite3.Error:
    db.rollback()
assert db.execute('SELECT * FROM pedidos_tarjetas').fetchone() == baseline
assert not db.execute("SELECT name FROM sqlite_master WHERE name IN ('card_artwork','consultas_tarjetas')").fetchall()

db.execute('BEGIN IMMEDIATE')
for sql in four + five: db.execute(sql)
db.commit()
assert db.execute(f"SELECT {','.join(names)} FROM pedidos_tarjetas").fetchone() == baseline
assert db.execute('SELECT producto_id, personalizacion_json FROM pedidos_tarjetas').fetchone() == ('resenas','{}')
file_values = ('a'*64,'owner','original.png','image/png',10,1012,638,'ready','[]','{}','hash','base64','2026-10-02')
db.execute('INSERT INTO card_artwork (token,owner_hash,filename,mime_type,size_bytes,width,height,validation_status,warnings_json,layout_json,sha256,content_base64,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',file_values)
db.execute('UPDATE card_artwork SET order_id=? WHERE token=?',('legacy-order','a'*64))
db.commit()
try:
    db.execute("UPDATE card_artwork SET order_id='missing-order'")
    raise AssertionError('Missing FK enforcement')
except sqlite3.IntegrityError: db.rollback()
assert not db.execute('PRAGMA foreign_key_check').fetchall()
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print('PASS: 004 -> 005; legacy values unchanged; atomic DDL rollback; foreign keys; integrity. No remote database accessed.')
