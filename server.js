const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Lade Konfiguration
const configFile = './config.json';
let appConfig = {};
try {
  appConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  console.log('✅ Konfiguration geladen aus config.json');
} catch (error) {
  console.error('❌ Fehler beim Laden der config.json:', error.message);
  process.exit(1);
}

const app = express();
const PORT = appConfig.display?.port || process.env.PORT || 3000;

// Cache für konfigurierbare Zeit (Rate Limit Compliance)
const cache = new NodeCache({ stdTTL: appConfig.data?.cacheTimeoutSeconds || 60 });

// OAuth Token Cache (1 Stunde)
const tokenCache = new NodeCache({ stdTTL: 3600 });

// Erstkontakt Cache - speichert wann ein Flugzeug zum ersten Mal gesehen wurde
const firstContactFile = 'first_contacts.json';
let firstContactData = {};
// Wie lange vergangene Flüge weiterhin angezeigt werden (in Minuten)
const PAST_RETENTION_MINUTES = parseInt(appConfig.data?.pastRetentionMinutes || process.env.PAST_RETENTION_MINUTES || 10, 10);

// Persistente Liste der zuletzt vergangenen Flüge (max 7)
const recentPastFile = 'recent_past.json';
let recentPast = [];

// Kategorie-Filter (große Flugzeuge) aus config.json
const CATEGORY_ALLOWLIST = new Set(appConfig.filtering?.categoryAllowlist || [3, 4, 5, 6]);

// Erstkontakt-Daten laden
try {
  if (fs.existsSync(firstContactFile)) {
    firstContactData = JSON.parse(fs.readFileSync(firstContactFile, 'utf8'));
  }
} catch (error) {
  console.log('Erstkontakt-Datei konnte nicht geladen werden, starte neu');
  firstContactData = {};
}
// Datei sicherstellen
if (!fs.existsSync(firstContactFile)) {
  try { fs.writeFileSync(firstContactFile, JSON.stringify(firstContactData, null, 2)); } catch {}
}

// Zuletzt vergangene Flüge laden
try {
  if (fs.existsSync(recentPastFile)) {
    recentPast = JSON.parse(fs.readFileSync(recentPastFile, 'utf8'));
  }
} catch (error) {
  console.log('recent_past.json konnte nicht geladen werden, starte neu');
  recentPast = [];
}
// Datei sicherstellen
if (!fs.existsSync(recentPastFile)) {
  try { fs.writeFileSync(recentPastFile, JSON.stringify(recentPast, null, 2)); } catch {}
}

// Datenmigration: Älteres Format (reiner Zeit-String) -> neues Objektformat
// Neues Format pro Callsign: { firstTime: 'HH:MM', lastSeenIso: string | null, status: 'Im Luftraum' | 'Vergangen' }
for (const key of Object.keys(firstContactData)) {
  const value = firstContactData[key];
  if (typeof value === 'string') {
    const legacyStatus = firstContactData[key + '_status'] || 'Im Luftraum';
    firstContactData[key] = {
      firstTime: value,
      lastSeenIso: null,
      lastActiveIso: null,
      status: legacyStatus,
    };
    delete firstContactData[key + '_status'];
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Konfiguration (Priorität: config.json, dann ENV als Fallback)
const config = {
  title: appConfig.display?.title || process.env.DISPLAY_TITLE || "Luftraum Friesenheim (Baden), Koordinaten und Umkreis (start 10 km)",
  coordinates: {
    lat: parseFloat(appConfig.monitoring?.coordinates?.lat || process.env.LAT || 48.3705),
    lon: parseFloat(appConfig.monitoring?.coordinates?.lon || process.env.LON || 7.8819)
  },
  radius: parseFloat(appConfig.monitoring?.radius || process.env.RADIUS || 10)
};

// OpenSky API Konfiguration
const OPENSKY_BASE_URL = 'https://opensky-network.org/api';
const OPENSKY_AUTH_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

// Airline Codes Mapping (Prefix -> Airline Name)
const airlinesFile = 'airlines.json';
let airlineCodes = {};
try {
  if (fs.existsSync(airlinesFile)) {
    airlineCodes = JSON.parse(fs.readFileSync(airlinesFile, 'utf8'));
  }
} catch (e) {
  console.warn('Konnte airlines.json nicht laden, verwende leere Mapping-Tabelle');
  airlineCodes = {};
}

function displayNameForCallsign(raw) {
  const cs = (raw || '').trim();
  const prefix = cs.slice(0, 3).toUpperCase();
  const mapped = airlineCodes[prefix];
  return mapped || cs || 'UNKNOWN';
}

// (Entfernt) Demo-Daten: Wir verwenden nur echte Daten oder Fallback aus Cache/RecentPast



// OAuth Token abrufen
async function getOpenSkyToken(forceRefresh = false) {
  try {
    // Prüfe Cache
    if (forceRefresh) {
      tokenCache.del('access_token');
    }
    let token = tokenCache.get('access_token');
    if (token) {
      return token;
    }

    const clientId = process.env.OPENSKY_USERNAME;
    const clientSecret = process.env.OPENSKY_PASSWORD;
    
    if (!clientId || !clientSecret) {
      throw new Error('OpenSky API Credentials fehlen. Bitte OPENSKY_USERNAME und OPENSKY_PASSWORD in .env setzen.');
    }

    const response = await axios.post(OPENSKY_AUTH_URL, 
      `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 60000 // 60 Sekunden für OAuth (OpenSky ist langsam)
      }
    );

    if (response.data && response.data.access_token) {
      token = response.data.access_token;
      const expiresIn = parseInt(response.data.expires_in || '3600', 10);
      // Lege TTL knapp unter Expires fest, min. 5 Minuten
      const ttl = Math.max(300, expiresIn - 60);
      tokenCache.set('access_token', token, ttl);
      console.log('OAuth Token erfolgreich abgerufen');
      return token;
    } else {
      throw new Error('Kein Access Token in der Antwort');
    }
  } catch (error) {
    console.error('Fehler beim Abrufen des OAuth Tokens:', error.message);
    return null;
  }
}

// Erstkontakt-Daten speichern
function saveFirstContactData() {
  try {
    fs.writeFileSync(firstContactFile, JSON.stringify(firstContactData, null, 2));
  } catch (error) {
    console.error('Fehler beim Speichern der Erstkontakt-Daten:', error);
  }
}

// Fallback-Liste erzeugen, wenn Live-Daten nicht verfügbar sind
function buildFallbackAircraft() {
  const cached = cache.get('aircraft');
  if (cached && cached.length) return cached;
  return recentPast.slice(0, appConfig.filtering?.maxDisplayCount || 7).map(e => ({
    time: e.firstTime,
    callsign: displayNameForCallsign(e.callsign),
    code: e.callsign,
    direction: '-', // Keine Richtungsdaten für vergangene Flüge
    status: 'Vergangen',
    altitude: 0,
    speed: 0,
    distance: 0
  }));
}

function saveRecentPast() {
  try {
    fs.writeFileSync(recentPastFile, JSON.stringify(recentPast, null, 2));
  } catch (error) {
    console.error('Fehler beim Speichern der recentPast-Daten:', error);
  }
}

// Entfernt alte/irrelevante Einträge aus first_contacts.json
function cleanFirstContacts() {
  const now = Date.now();
  for (const [cs, meta] of Object.entries(firstContactData)) {
    if (typeof meta !== 'object') {
      delete firstContactData[cs];
      continue;
    }
    const inRecent = recentPast.some(e => e.callsign === cs);
    const isActive = meta.status === 'Im Luftraum';
    const freshPast = meta.lastActiveIso
      ? (now - new Date(meta.lastActiveIso).getTime()) / 60000 <= PAST_RETENTION_MINUTES
      : false;
    const keep = inRecent || isActive || freshPast;
    if (!keep) delete firstContactData[cs];
  }
  saveFirstContactData();
}

function upsertRecentPast(entry) {
  // entry: { callsign, firstTime, lastActiveIso }
  // Entferne gleiche Callsign-Einträge
  recentPast = recentPast.filter(e => e.callsign !== entry.callsign);
  recentPast.push(entry);
  // Sortiere nach lastActiveIso absteigend und halte max 7
  recentPast.sort((a, b) => new Date(b.lastActiveIso) - new Date(a.lastActiveIso));
  recentPast = recentPast.slice(0, appConfig.filtering?.maxDisplayCount || 7);
  saveRecentPast();
  // Beim Verschieben gleichzeitig Altlasten aus first_contacts bereinigen
  cleanFirstContacts();
}

// Hilfsfunktion: Entfernung zwischen zwei Koordinaten berechnen (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Erdradius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Hilfsfunktion: Konvertiere Grad zu Himmelsrichtung
function degreesToDirection(degrees) {
  if (degrees === null || degrees === undefined || isNaN(degrees)) {
    return '-';
  }
  
  // Normalisiere auf 0-360 Grad
  degrees = ((degrees % 360) + 360) % 360;
  
  const directions = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

// Flugzeuge im Luftraum abrufen
async function getAircraftInAirspace() {
  try {
    // Rate Limit Compliance: Mindestens 6 Sekunden zwischen Anfragen
    const lastRequest = cache.get('lastRequestTime');
    const now = Date.now();
    
    if (lastRequest && (now - lastRequest) < (appConfig.data?.rateLimitDelaySeconds || 6) * 1000) {
      console.log('Rate Limit: Warte auf nächste Anfrage...');
      return cache.get('aircraft') || [];
    }
    
    cache.set('lastRequestTime', now);
    
    // OAuth Token abrufen
    const token = await getOpenSkyToken();
    if (!token) {
      console.log('Kein OAuth Token verfügbar - verwende Fallback-Daten');
      return buildFallbackAircraft();
    }
    
    let response;
    try {
      response = await axios.get(`${OPENSKY_BASE_URL}/states/all`, {
        timeout: 60000, // 60 Sekunden für API Calls (OpenSky ist langsam)
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'AirspaceMonitor/1.0 (https://github.com/your-repo)'
        }
      });
    } catch (err) {
      // Bei 401: Token erneuern und einmalig retry
      if (err.response && err.response.status === 401) {
        console.warn('401 von OpenSky – Token wird erneuert und Request wiederholt...');
        const refreshed = await getOpenSkyToken(true);
        if (refreshed) {
          response = await axios.get(`${OPENSKY_BASE_URL}/states/all`, {
            timeout: 60000, // 60 Sekunden für API Calls (OpenSky ist langsam)
            headers: {
              'Authorization': `Bearer ${refreshed}`,
              'User-Agent': 'AirspaceMonitor/1.0 (https://github.com/your-repo)'
            }
          });
        } else {
          return buildFallbackAircraft();
        }
      } else {
        throw err;
      }
    }

    if (!response.data || !response.data.states) {
      console.log('Keine Daten von OpenSky - verwende Fallback-Daten');
      return buildFallbackAircraft();
    }

    let aircraft = response.data.states
      .filter(state => {
        if (!state[5] || !state[6]) return false; // Keine Koordinaten
        // Kategorie-Filter: state[17] ist category laut OpenSky
        const category = typeof state[17] === 'number' ? state[17] : null;
        if (category !== null && CATEGORY_ALLOWLIST.size > 0 && !CATEGORY_ALLOWLIST.has(category)) {
          return false;
        }
        
        const distance = calculateDistance(
          config.coordinates.lat, config.coordinates.lon,
          state[6], state[5]
        );
        
        return distance <= config.radius;
      })
      .map(state => {
        const distance = calculateDistance(
          config.coordinates.lat, config.coordinates.lon,
          state[6], state[5]
        );

        const callsignRaw = (state[1] || 'UNKNOWN').trim();
        const callsign = displayNameForCallsign(callsignRaw);
        const currentTime = new Date().toLocaleTimeString('de-DE', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        
        // Status bestimmen basierend auf Höhe und Geschwindigkeit
        let status = 'Vergangen';
        if (state[7] && state[7] > 0) { // Höhe über 0
          status = 'Im Luftraum';
        }
        
        // Erstkontakt / Status-Timeline verwalten (persistiert)
        let meta = firstContactData[callsignRaw];
        if (!meta) {
          meta = { firstTime: currentTime, lastSeenIso: null, lastActiveIso: null, status };
          firstContactData[callsignRaw] = meta;
        }
        // Sichtung in diesem Poll
        meta.lastSeenIso = new Date().toISOString();
        // Wenn aktiv, letzte Aktivzeit aktualisieren
        if (status === 'Im Luftraum') {
          meta.lastActiveIso = meta.lastSeenIso;
        }
        // Status speichern und bei Wechsel auf "Vergangen" in recentPast aufnehmen
        const prev = meta.status;
        meta.status = status;
        if (prev === 'Im Luftraum' && status === 'Vergangen' && meta.lastActiveIso) {
          upsertRecentPast({ callsign: callsignRaw, firstTime: meta.firstTime, lastActiveIso: meta.lastActiveIso });
        }
        saveFirstContactData();
        
        return {
          time: meta.firstTime, // Erstkontakt Zeit verwenden
          callsign: callsign,
          code: callsignRaw,
          direction: degreesToDirection(state[10]), // state[10] ist track (true track in decimal degrees)
          status: status,
          altitude: state[7] || 0,
          speed: state[9] || 0,
          distance: Math.round(distance * 10) / 10
        };
      });

    // Set der aktuell gesehenen Callsigns
    const seenNow = new Set(aircraft.map(a => a.code || a.callsign));
    // Für alle bisher als aktiv geführten Flüge, die jetzt fehlen: auf "Vergangen" setzen und in recent_past aufnehmen
    for (const [cs, meta] of Object.entries(firstContactData)) {
      if (typeof meta !== 'object') continue;
      if (meta.status === 'Im Luftraum' && !seenNow.has(cs)) {
        // Als vergangen markieren
        meta.status = 'Vergangen';
        if (meta.lastActiveIso) {
          upsertRecentPast({ callsign: cs, firstTime: meta.firstTime, lastActiveIso: meta.lastActiveIso });
        }
      }
    }
    saveFirstContactData();

    // Flüge, die nicht mehr in der API sind, aber kürzlich aktiv waren, ergänzen und als "Vergangen" listen
    const augmented = aircraft
      .concat(
        Object.entries(firstContactData)
          .filter(([cs, meta]) => typeof meta === 'object')
          .filter(([cs, meta]) => {
            // nicht doppelt, wenn schon in aktueller Liste
            const exists = aircraft.some(a => a.callsign === cs);
            return meta.lastActiveIso && meta.status === 'Vergangen' && !exists;
          })
          .map(([cs, meta]) => ({
            time: meta.firstTime,
            callsign: displayNameForCallsign(cs),
            code: cs,
            direction: '-', // Keine Richtungsdaten für vergangene Flüge
            status: 'Vergangen',
            altitude: 0,
            speed: 0,
            distance: 0
          }))
      );

    // Falls immer noch weniger als 7 Einträge: mit recentPast auffüllen
    if (augmented.length < 7 && recentPast.length > 0) {
      const need = 7 - augmented.length;
      const toAdd = recentPast
        .filter(e => !augmented.some(a => (a.code || a.callsign) === e.callsign))
        .slice(0, need)
        .map(e => ({
          time: e.firstTime,
          callsign: displayNameForCallsign(e.callsign),
          code: e.callsign,
          direction: '-', // Keine Richtungsdaten für vergangene Flüge
          status: 'Vergangen',
          altitude: 0,
          speed: 0,
          distance: 0
        }));
      aircraft = augmented.concat(toAdd);
    } else {
      aircraft = augmented;
    }
      // Doppelte entfernen (bevorzugt aktuelle Einträge)
      aircraft = aircraft.reduce((acc, cur) => {
        if (!acc.find(a => (a.code || a.callsign) === (cur.code || cur.callsign))) acc.push(cur);
        return acc;
      }, []);
      // Retention: Vergangene Flüge nach Karenzzeit ausblenden
      aircraft = aircraft.filter(item => {
        if (item.status === 'Im Luftraum') return true;
        // Halte Seeds aus recent_past.json unabhängig von firstContactData
        const isInRecentPast = recentPast.some(e => e.callsign === (item.code || item.callsign));
        if (isInRecentPast) return true;
        const meta = firstContactData[item.code || item.callsign];
        if (!meta || !meta.lastActiveIso) return false;
        const minutesSinceActive = (Date.now() - new Date(meta.lastActiveIso).getTime()) / 60000;
        return minutesSinceActive <= PAST_RETENTION_MINUTES;
      });
      aircraft = aircraft.sort((a, b) => {
        // Sortierung: Im Luftraum zuerst, dann nach Uhrzeit (neueste zuerst)
        if (a.status === 'Im Luftraum' && b.status !== 'Im Luftraum') return -1;
        if (a.status !== 'Im Luftraum' && b.status === 'Im Luftraum') return 1;
        // Innerhalb der Gruppen nach Uhrzeit sortieren (neueste zuerst)
        return b.time.localeCompare(a.time);
      }).slice(0, appConfig.filtering?.maxDisplayCount || 7); // Maximal konfigurierbare Anzahl Flugzeuge anzeigen

    return aircraft;
  } catch (error) {
    console.error('Fehler beim Abrufen der Flugzeugdaten:', error.message);
    
    // Bei Rate Limit Fehler: Verwende gecachte Daten
    if (error.response && error.response.status === 429) {
      console.log('Rate Limit erreicht - verwende gecachte Daten');
      return cache.get('aircraft') || [];
    }
    
    // Allgemeiner Fallback
    return buildFallbackAircraft();
  }
}

// API Endpoints
app.get('/api/aircraft', async (req, res) => {
  try {
    let aircraft = cache.get('aircraft');
    
    if (!aircraft) {
      aircraft = await getAircraftInAirspace();
      cache.set('aircraft', aircraft);
    }
    
    res.json({
      title: config.title,
      aircraft: aircraft,
      timestamp: new Date().toISOString(),
      coordinates: config.coordinates,
      radius: config.radius
    });
  } catch (error) {
    console.error('API Fehler:', error);
    res.status(500).json({ error: 'Interner Server Fehler' });
  }
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

// Debug endpoint for Render troubleshooting
app.get('/api/debug', async (req, res) => {
  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      hasOpenSkyCredentials: !!(process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD),
      cacheStatus: {
        aircraftCached: !!cache.get('aircraft'),
        tokenCached: !!tokenCache.get('access_token')
      },
      lastRequestTime: cache.get('lastRequestTime') || 'never'
    };
    
    // Test OpenSky connectivity (ohne echte API calls)
    const testUrl = 'https://opensky-network.org';
    try {
      const testResponse = await axios.get(testUrl, { timeout: 5000 });
      debugInfo.openskyConnectivity = 'OK';
    } catch (error) {
      debugInfo.openskyConnectivity = `Error: ${error.message}`;
    }
    
    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Hauptseite
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚁 Luftraumüberwachung läuft auf Port ${PORT}`);
  console.log(`📍 Überwachungsgebiet: ${config.coordinates.lat}, ${config.coordinates.lon} (${config.radius}km Radius)`);
  console.log(`📺 E-Ink Display optimiert für 800x480px`);
});
