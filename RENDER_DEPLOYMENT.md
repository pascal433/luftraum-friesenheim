# 🚀 Render Deployment Guide

## Schritt-für-Schritt Anleitung für Render.com

### 1. GitHub Repository erstellen
1. Gehe zu [GitHub.com](https://github.com) und erstelle einen Account
2. Erstelle ein neues Repository: "luftraum-friesenheim"
3. Repository auf "Public" setzen (für Render Free Tier)

### 2. Code zu GitHub pushen
```bash
git add .
git commit -m "Initial commit - Luftraumüberwachung"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/luftraum-friesenheim.git
git push -u origin main
```

### 3. Render Account erstellen
1. Gehe zu [render.com](https://render.com)
2. Registriere dich mit GitHub Account
3. Autorisiere Render für GitHub-Zugriff

### 4. Web Service erstellen
1. Dashboard → "New" → "Web Service"
2. GitHub Repository auswählen: `luftraum-friesenheim`
3. Einstellungen:
   - **Name**: `luftraum-friesenheim`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

### 5. Environment Variablen setzen
Im Render Dashboard unter "Environment":

```
OPENSKY_USERNAME = your-opensky-client-id
OPENSKY_PASSWORD = your-opensky-client-secret
```

### 6. Deploy starten
- Klicke "Create Web Service"
- Render erkennt automatisch Node.js
- Deployment dauert 2-3 Minuten
- URL wird bereitgestellt: `https://luftraum-friesenheim.onrender.com`

### 7. Wichtige Hinweise für Render Free Tier

#### ⚠️ Sleep-Modus
- Service "schläft" nach 15 Min Inaktivität
- Erste Anfrage nach Schlaf: ~30s Startzeit
- Lösung: Ping-Service oder Upgrade auf bezahlten Plan

#### 💾 Persistent Storage
- JSON-Dateien bleiben erhalten zwischen Deployments
- Aber: Service-Neustart löscht temporäre Dateien
- Für Produktion: Database empfohlen

#### 🔄 Auto-Deploy
- Jeder Git-Push löst automatisches Deployment aus
- Branch: `main` wird überwacht
- Build-Logs in Render Dashboard einsehbar

### 8. Nach dem Deployment testen

1. **Basis-URL aufrufen**: `https://deine-app.onrender.com`
2. **API testen**: `https://deine-app.onrender.com/api/aircraft`
3. **Config prüfen**: `https://deine-app.onrender.com/api/config`

### 9. Custom Domain (optional)
1. Render Dashboard → Settings → Custom Domains
2. Domain hinzufügen (kostenlos bei Free Tier)
3. DNS-Einstellungen bei Domain-Provider anpassen

### 🆘 Troubleshooting

#### Build schlägt fehl
- Prüfe `package.json` auf korrekte Dependencies
- Stelle sicher, dass `npm start` funktioniert

#### App startet nicht
- Prüfe Environment Variablen
- Schaue in die Build-Logs
- Port muss aus `process.env.PORT` kommen (macht Render automatisch)

#### OpenSky API Fehler
- Prüfe API-Credentials in Environment
- Rate Limits beachten (alle 6 Sekunden)

#### Performance Issues
- Free Tier hat CPU/Memory Limits
- Bei hoher Last: Paid Plan erwägen

### 📞 Support
- [Render Docs](https://render.com/docs)
- [Render Community](https://community.render.com)
