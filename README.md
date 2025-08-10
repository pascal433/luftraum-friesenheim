# 🛩️ Luftraumüberwachung Friesenheim

Eine Echtzeit-Luftraumüberwachung mit authentischem Airport Board Design, optimiert für E-Ink Displays.

## 🚀 Features

- **Echtzeit-Flugdaten** von OpenSky Network API
- **Airport Board Design** mit authentischer Optik
- **E-Ink Display Optimierung** (800x480px, Spectra 6)
- **Flugrichtungsanzeige** (N, NO, O, SO, S, SW, W, NW)
- **Airline-Name Mapping** (DLH → Lufthansa, etc.)
- **Kategoriefilter** für große Flugzeuge (3, 4, 5, 6)
- **Persistente Flughistorie** mit JSON-Speicherung
- **OAuth2 Authentifizierung** für OpenSky API
- **Rate Limit Compliance** mit intelligentem Caching

## 📊 Live Demo

Die Anwendung zeigt:
- **Zeit**: Erstkontakt-Zeit (HH:MM)
- **Flug**: Airline-Name oder Callsign
- **Richtung**: Flugrichtung als Text
- **Status**: Im Luftraum (grün) / Vergangen (grau)

## 🔧 Technologie

- **Backend**: Node.js + Express
- **API**: OpenSky Network mit OAuth2
- **Frontend**: Vanilla JavaScript (E-Ink optimiert)
- **Caching**: NodeCache + JSON-Persistierung
- **Design**: Monospace Fonts, Airport Board Styling

## 🌍 Deployment auf Render

### 1. Environment Variablen setzen:

```bash
OPENSKY_USERNAME=your-opensky-client-id
OPENSKY_PASSWORD=your-opensky-client-secret
```

### 2. Konfiguration anpassen:

Die Überwachungsparameter werden über `config.json` gesteuert:

```json
{
  "display": {
    "title": "Luftraum Friesenheim (Baden)",
    "port": 3000
  },
  "monitoring": {
    "coordinates": {
      "lat": 48.3705,
      "lon": 7.8819
    },
    "radius": 15
  },
  "filtering": {
    "categoryAllowlist": [3, 4, 5, 6],
    "maxDisplayCount": 7
  },
  "data": {
    "pastRetentionMinutes": 10,
    "cacheTimeoutSeconds": 60,
    "rateLimitDelaySeconds": 6
  }
}
```

### 3. OpenSky API Setup:

1. Account auf [OpenSky Network](https://opensky-network.org/) erstellen
2. API Client in Account-Einstellungen erstellen
3. `client_id` und `client_secret` als ENV-Variablen setzen

## 📱 E-Ink Display Optimierung

- **Minimale Animationen** für bessere E-Ink Performance
- **Hoher Kontrast** (Schwarz/Weiß/Gelb/Grün)
- **Feste Dimensionen** (800x480px)
- **Monospace Fonts** für scharfe Darstellung
- **Touch-Gesten** für manuelle Updates

## 🎯 Überwachungsgebiet

Standard-Konfiguration für **Friesenheim (Baden)**:
- **Koordinaten**: 48.3705°N, 7.8819°E
- **Radius**: 15km
- **Kategorien**: Nur große Flugzeuge (3-6)
- **Update-Rate**: Alle 60 Sekunden

## 📄 Lizenz

MIT License - siehe [LICENSE](LICENSE) für Details.

---

**Entwickelt für E-Ink Displays und Flugbegeisterte** ✈️