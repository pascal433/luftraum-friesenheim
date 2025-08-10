# 🚀 Vercel Deployment Guide

## Schritt-für-Schritt Anleitung für Vercel.com

### 1. Vercel Account erstellen
1. Gehe zu [vercel.com](https://vercel.com)
2. **"Sign up with GitHub"** (nutze deinen bestehenden GitHub Account)
3. Autorisiere Vercel für GitHub-Zugriff

### 2. Projekt deployen
1. Vercel Dashboard → **"New Project"**
2. **Import Git Repository** → `pascal433/luftraum-friesenheim` auswählen
3. **Framework Preset**: "Other" (wird automatisch erkannt)
4. **Root Directory**: `.` (Standard)
5. **Build Settings**: 
   - Build Command: `npm run build` (automatisch)
   - Output Directory: `public` (automatisch)
   - Install Command: `npm install` (automatisch)

### 3. Environment Variables setzen
**Bevor du deployest, unter "Environment Variables":**

```
OPENSKY_USERNAME = panders-api-client
OPENSKY_PASSWORD = MojhqBC8vuZJYz1LKIPNRSipVpsR8CZD
```

### 4. Deploy starten
- **"Deploy"** klicken
- Vercel baut und deployed automatisch
- Dauert ~2-3 Minuten
- URL wird bereitgestellt: `https://luftraum-friesenheim.vercel.app`

### 5. Wichtige Vercel-Besonderheiten

#### ✅ **Vorteile gegenüber Render:**
- **Andere IP-Range** → Bessere OpenSky Erreichbarkeit
- **Kein Sleep-Mode** → Immer verfügbar
- **Schnellere Cold Starts** → ~200ms statt 30s
- **Bessere Performance** → Edge-Network

#### ⚠️ **Vercel Limits (Free Tier):**
- **Execution Time**: 10s pro Serverless Function
- **Memory**: 1024MB
- **Bandwidth**: 100GB/Monat
- **Function Invocations**: 100GB/Monat

#### 🔄 **Serverless Functions:**
- Jede API-Route läuft als separate Function
- Kein persistenter State zwischen Requests
- JSON-Dateien werden **nicht persistent** gespeichert

### 6. Nach dem Deployment testen

1. **Basis-URL**: `https://luftraum-friesenheim.vercel.app`
2. **Debug-Endpoint**: `https://luftraum-friesenheim.vercel.app/api/debug`
3. **API testen**: `https://luftraum-friesenheim.vercel.app/api/aircraft`

**Erwartete Debug-Response:**
```json
{
  "openskyConnectivity": "OK",
  "hasOpenSkyCredentials": true,
  "environment": "production"
}
```

### 7. Custom Domain (optional)
1. Vercel Dashboard → Settings → Domains
2. Domain hinzufügen (kostenlos bei Free Tier)
3. DNS-Einstellungen bei Domain-Provider anpassen

### 🆘 Troubleshooting

#### Build schlägt fehl
- Prüfe `package.json` Dependencies
- Schaue in Build-Logs

#### Environment Variables nicht gesetzt
- Vercel Dashboard → Settings → Environment Variables
- Nach Änderung: Redeploy erforderlich

#### OpenSky API funktioniert nicht
- Teste `/api/debug` Endpoint
- Prüfe `openskyConnectivity` Status

#### Vercel Function Timeout
- 10s Limit für Serverless Functions
- Bei OpenSky Timeouts: Retry-Logic implementieren

### 📞 Support
- [Vercel Docs](https://vercel.com/docs)
- [Vercel Community](https://github.com/vercel/vercel/discussions)
