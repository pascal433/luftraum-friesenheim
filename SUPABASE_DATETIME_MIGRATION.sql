-- Migration: first_time von VARCHAR zu TIMESTAMP WITH TIME ZONE
-- Löst Tageswechsel-Bug bei Flugzeug-Updates

-- 1. Neue Spalte hinzufügen
ALTER TABLE first_contacts 
ADD COLUMN first_time_new TIMESTAMP WITH TIME ZONE;

-- 2. Bestehende HH:MM Strings zu heutigen Timestamps konvertieren
UPDATE first_contacts 
SET first_time_new = (CURRENT_DATE + first_time::TIME)::TIMESTAMP WITH TIME ZONE
WHERE first_time ~ '^\d{1,2}:\d{2}$';

-- 3. Alte Spalte löschen und neue umbenennen
ALTER TABLE first_contacts DROP COLUMN first_time;
ALTER TABLE first_contacts RENAME COLUMN first_time_new TO first_time;

-- 4. Index für bessere Performance bei Sortierung
CREATE INDEX IF NOT EXISTS idx_first_contacts_first_time ON first_contacts(first_time DESC);

-- 5. Prüfe das Ergebnis
SELECT callsign, first_time, status FROM first_contacts ORDER BY first_time DESC LIMIT 5;
