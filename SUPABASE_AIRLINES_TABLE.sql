-- Airlines Mapping Table für Supabase
-- Führe dieses SQL im Supabase Dashboard → SQL Editor aus

-- Table: airlines
CREATE TABLE airlines (
  code VARCHAR(3) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- RLS deaktivieren für einfachen Zugriff
ALTER TABLE airlines DISABLE ROW LEVEL SECURITY;

-- Initiale Daten einfügen (aus airlines.json)
INSERT INTO airlines (code, name) VALUES
('DLH', 'Lufthansa'),
('AFR', 'Air France'),
('CFG', 'Condor'),
('BAW', 'British Airways'),
('RYR', 'Ryanair'),
('UAL', 'United Airlines'),
('EZS', 'easyJet Switzerland'),
('VLG', 'Eurowings'),
('ELY', 'El Al'),
('EVA', 'EVA Air'),
('MAC', 'Macedonian Airlines');

-- Index für bessere Performance
CREATE INDEX idx_airlines_code ON airlines(code);
