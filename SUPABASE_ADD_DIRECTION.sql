-- Richtung (Direction) zu first_contacts Tabelle hinzufügen
-- Führe dieses SQL im Supabase Dashboard → SQL Editor aus

-- Neue Spalte für direction hinzufügen
ALTER TABLE first_contacts ADD COLUMN direction VARCHAR(3) DEFAULT '-';

-- Index für bessere Performance (optional)
CREATE INDEX idx_first_contacts_direction ON first_contacts(direction);
