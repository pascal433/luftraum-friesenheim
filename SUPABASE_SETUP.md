# 🗄️ Supabase Setup Guide

## Schritt 1: Supabase Account erstellen

1. Gehe zu [supabase.com](https://supabase.com)
2. **"Start your project"** → **"Sign up with GitHub"**
3. **"New project"** erstellen
4. **Projekt-Name:** `luftraum-friesenheim`
5. **Database Password:** (sicher merken!)
6. **Region:** Europe (eu-central-1)
7. **"Create new project"** - dauert ~2 Minuten

## Schritt 2: Database Tables erstellen

**Im Supabase Dashboard → SQL Editor:**

```sql
-- Table: first_contacts
CREATE TABLE first_contacts (
  callsign VARCHAR(20) PRIMARY KEY,
  first_time VARCHAR(10) NOT NULL,
  last_seen_iso TIMESTAMP,
  last_active_iso TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'Im Luftraum',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table: recent_past  
CREATE TABLE recent_past (
  id SERIAL PRIMARY KEY,
  callsign VARCHAR(20) NOT NULL,
  first_time VARCHAR(10) NOT NULL,
  last_active_iso TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index für bessere Performance
CREATE INDEX idx_recent_past_last_active ON recent_past(last_active_iso DESC);
CREATE INDEX idx_first_contacts_status ON first_contacts(status);

-- Trigger für updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_first_contacts_updated_at 
    BEFORE UPDATE ON first_contacts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

## Schritt 3: API Keys holen

**Supabase Dashboard → Settings → API:**

- **Project URL:** `https://xxx.supabase.co`
- **anon/public Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6...`

## Schritt 4: Environment Variables

**In Vercel Dashboard → Settings → Environment Variables:**

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

## Schritt 5: Row Level Security (RLS)

**Für öffentlichen Zugriff (nur für diese App):**

```sql
-- RLS deaktivieren für einfachen Zugriff
ALTER TABLE first_contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE recent_past DISABLE ROW LEVEL SECURITY;
```

**Oder sichere Policies (empfohlen):**

```sql
-- RLS aktivieren
ALTER TABLE first_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recent_past ENABLE ROW LEVEL SECURITY;

-- Policies für anon user
CREATE POLICY "Allow all operations for anon users" ON first_contacts
FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for anon users" ON recent_past  
FOR ALL USING (true) WITH CHECK (true);
```

## ✅ Fertig!

Nach diesem Setup sollte die App mit Supabase funktionieren!
