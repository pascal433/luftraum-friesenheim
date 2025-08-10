const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const WRITE_ENABLED = !['false', '0', 'no'].includes(String(process.env.WRITE_ENABLED || 'true').toLowerCase());

// Konfiguration aus Environment Variables laden
const appConfig = {
  display: {
    title: process.env.DISPLAY_TITLE || 'Luftraum Friesenheim (Baden)',
    radius: parseInt(process.env.RADIUS) || 10
  },
  monitoring: {
    updateInterval: parseInt(process.env.UPDATE_INTERVAL) || 6000,
    cacheTtl: parseInt(process.env.CACHE_TTL) || 60000
  },
  filtering: {
    maxDisplayCount: parseInt(process.env.MAX_DISPLAY_COUNT) || 7,
    categoryAllowlist: process.env.CATEGORY_ALLOWLIST?.split(',').map(Number) || [3, 4, 5, 6]
  },
  data: {
    maxFirstContacts: parseInt(process.env.MAX_FIRST_CONTACTS) || 100,
    maxRecentPast: parseInt(process.env.MAX_RECENT_PAST) || 7
  }
};

console.log('✅ Konfiguration aus Environment Variables geladen');

const app = express();
const PORT = process.env.PORT || appConfig.display?.port || 3000;

// Supabase Client initialisieren
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase Client initialisiert');
} else {
  console.log('⚠️ Supabase Credentials fehlen, verwende lokale JSON-Dateien');
}

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

// === SUPABASE DATABASE FUNCTIONS ===

// First Contacts aus Supabase laden
async function loadFirstContactsFromDB() {
  if (!supabase) return firstContactData;
  
  try {
    const { data, error } = await supabase
      .from('first_contacts')
      .select('*');
    
    if (error) {
      console.log('⚠️ Supabase first_contacts Fehler:', error.message);
      return firstContactData;
    }
    
    const dbData = {};
    data.forEach(row => {
      dbData[row.callsign] = {
        firstTime: row.first_time,
        status: row.status,
        direction: row.direction || '-',
        displayName: row.display_name || null
      };
    });
    
    console.log(`✅ ${data.length} First Contacts aus Supabase geladen`);
    return dbData;
  } catch (error) {
    console.log('⚠️ Supabase loadFirstContacts Fehler:', error.message);
    return firstContactData;
  }
}

// First Contact in Supabase speichern/updaten
async function saveFirstContactToDB(callsign, contactData) {
  if (!supabase || !WRITE_ENABLED) return true;
  
  try {
    const { error } = await supabase
      .from('first_contacts')
      .upsert({
        callsign: callsign,
        first_time: contactData.firstTime,
        status: contactData.status,
        direction: contactData.direction || '-',
        display_name: displayNameForCallsign(callsign)
      });
    
    if (error) {
      console.log('⚠️ Supabase saveFirstContact Fehler:', error.message);
      return false;
    }
    if (pollWriteTrack) {
      pollWriteCount += 1;
    }
    return true;
  } catch (error) {
    console.log('⚠️ Supabase saveFirstContact Fehler:', error.message);
    return false;
  }
}

// First Contact in Supabase löschen
async function deleteFirstContactFromDB(callsign) {
  if (!supabase || !WRITE_ENABLED) return true;
  try {
    const { error } = await supabase
      .from('first_contacts')
      .delete()
      .eq('callsign', callsign);
    if (error) {
      console.log('⚠️ Supabase deleteFirstContact Fehler:', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.log('⚠️ Supabase deleteFirstContact Fehler:', error.message);
    return false;
  }
}

// Recent Past in Supabase speichern (legacy, no longer used)
// Removed legacy recent_past logic

// Recent Past: einzelne Zeile idempotent in DB upserten
async function upsertRecentPastRowToDB(entry) {
  if (!supabase || !WRITE_ENABLED) return true;
  try {
    await supabase.from('recent_past').delete().eq('callsign', entry.callsign);
    const { error } = await supabase.from('recent_past').insert({
      callsign: entry.callsign,
      first_time: entry.firstTime,
      last_active_iso: entry.lastActiveIso,
      direction: entry.direction || null
    });
    if (error) {
      console.log('⚠️ Supabase upsertRecentPastRow Fehler:', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.log('⚠️ Supabase upsertRecentPastRow Fehler:', error.message);
    return false;
  }
}

function pruneFirstContactsMemory() {
  const maxN = appConfig.data?.maxRecentPast || 7;
  const active = Object.entries(firstContactData).filter(([, m]) => m && m.status === 'Im Luftraum');
  const past = Object.entries(firstContactData)
    .filter(([, m]) => m && m.status === 'Vergangen')
    .sort((a, b) => new Date(b[1].firstTime || 0) - new Date(a[1].firstTime || 0))
    .slice(0, maxN);
  const keepSet = new Set([...active.map(([cs]) => cs), ...past.map(([cs]) => cs)]);
  for (const cs of Object.keys(firstContactData)) {
    if (!keepSet.has(cs)) delete firstContactData[cs];
  }
}

// Alte First Contacts aus Supabase löschen oder migrieren
async function cleanFirstContactsDB() {
  if (!supabase || !WRITE_ENABLED) {
    pruneFirstContactsMemory();
    return true;
  }
  
  try {
    const maxN = appConfig.data?.maxRecentPast || 7;
    const { data: pastRows, error: selErr } = await supabase
      .from('first_contacts')
      .select('callsign, first_time')
      .eq('status', 'Vergangen')
      .order('first_time', { ascending: false });
    if (!selErr && pastRows) {
      const toDelete = pastRows.slice(maxN).map(r => r.callsign);
      if (toDelete.length > 0) {
        await supabase.from('first_contacts').delete().in('callsign', toDelete);
      }
    }
    return true;
  } catch (error) {
    console.log('⚠️ Supabase cleanFirstContacts Fehler:', error.message);
    return false;
  }
}

// Daten beim Start laden (Fallback für lokale Entwicklung)
if (!supabase) {
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
} else {
  // Supabase: Daten beim Start laden
  loadFirstContactsFromDB().then(data => {
    firstContactData = data;
  });
  // Recent Past wird nicht mehr separat geladen, sondern als Teil von first_contacts
}

// Datenmigration: Älteres Format (reiner Zeit-String) -> neues Objektformat
// Neues Format pro Callsign: { firstTime: 'HH:MM', lastSeenIso: string | null, status: 'Im Luftraum' | 'Vergangen' }
for (const key of Object.keys(firstContactData)) {
  const value = firstContactData[key];
  if (typeof value === 'string') {
    const legacyStatus = firstContactData[key + '_status'] || 'Im Luftraum';
    firstContactData[key] = {
      firstTime: value,
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
let airlineCodes = {};

// Airlines aus Supabase laden
async function loadAirlinesFromDB() {
  if (!supabase) return airlineCodes;
  
  try {
    const { data, error } = await supabase
      .from('airlines')
      .select('code, name');
    
    if (error) {
      console.log('⚠️ Supabase airlines Fehler:', error.message);
      return airlineCodes;
    }
    
    const dbData = {};
    data.forEach(row => {
      dbData[row.code] = row.name;
    });
    
    console.log(`✅ ${data.length} Airlines aus Supabase geladen`);
    return dbData;
  } catch (error) {
    console.log('⚠️ Supabase loadAirlines Fehler:', error.message);
    return airlineCodes;
  }
}

// Fallback: Airlines aus JSON-Datei laden (für lokale Entwicklung ohne Supabase)
if (!supabase) {
  try {
    const airlinePaths = ['./airlines.json', 'airlines.json', process.cwd() + '/airlines.json'];
    let airlinesFile = null;
    
    for (const path of airlinePaths) {
      if (fs.existsSync(path)) {
        airlinesFile = path;
        break;
      }
    }
    
    if (airlinesFile) {
      airlineCodes = JSON.parse(fs.readFileSync(airlinesFile, 'utf8'));
      console.log('✅ Airlines geladen aus airlines.json');
    } else {
      console.log('⚠️ airlines.json nicht gefunden, verwende leere Mapping-Tabelle');
    }
  } catch (e) {
    console.warn('⚠️ airlines.json Fehler, verwende leere Mapping-Tabelle:', e.message);
    airlineCodes = {};
  }
} else {
  // Supabase: Airlines beim Start laden
  loadAirlinesFromDB().then(data => {
    airlineCodes = data;
  });
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
  const pastEntries = Object.entries(firstContactData)
    .filter(([cs, meta]) => typeof meta === 'object' && meta.status === 'Vergangen')
    .sort((a, b) => new Date(b[1].firstTime || 0) - new Date(a[1].firstTime || 0))
    .slice(0, appConfig.filtering?.maxDisplayCount || 7)
    .map(([cs, meta]) => ({
      time: formatTimeForDisplay(meta.firstTime),
      callsign: displayNameForCallsign(cs),
      code: cs,
      direction: meta.direction || '-',
      status: 'Vergangen',
      altitude: 0,
      speed: 0,
      distance: 0
    }));
  return pastEntries;
}

// Entfernt alte/irrelevante Einträge aus first_contacts.json
function cleanFirstContacts() {
  const now = Date.now();
  for (const [cs, meta] of Object.entries(firstContactData)) {
    if (typeof meta !== 'object') {
      delete firstContactData[cs];
      continue;
    }
    const isActive = meta.status === 'Im Luftraum';
    const keep = isActive;
    if (!keep) delete firstContactData[cs];
  }
  
  if (supabase) {
    // Alle geänderten Contacts in Supabase speichern
    for (const [callsign, data] of Object.entries(firstContactData)) {
      saveFirstContactToDB(callsign, data);
    }
  } else {
    saveFirstContactData();
  }
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

// Hilfsfunktion: ISO- oder HH:MM-Zeit zu HH:MM Format konvertieren
function formatTimeForDisplay(value) {
  if (!value) return '-';
  try {
    if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) {
      return value.trim();
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: TIMEZONE
    }).format(date);
  } catch (error) {
    console.error('Fehler beim Formatieren der Zeit:', error);
    return '-';
  }
}

function nowHHMM() {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIMEZONE
  }).format(new Date());
}

// Tracking für letzten Cron-Poll
let lastCronPoll = { timestamp: null, found: 0, saved: 0, snapshot: 0, error: null };
let pollWriteTrack = false;
let pollWriteCount = 0;

let initialDataLoaded = false;
let initialLoadPromise = null;
async function ensureInitialLoad() {
  if (!supabase) return;
  if (initialDataLoaded) return;
  if (!initialLoadPromise) {
    initialLoadPromise = (async () => {
      const [fc, ac] = await Promise.all([
        loadFirstContactsFromDB(),
        loadAirlinesFromDB()
      ]);
      if (fc && typeof fc === 'object') {
        firstContactData = fc;
      }
      if (ac && typeof ac === 'object') {
        airlineCodes = ac;
      }
      initialDataLoaded = true;
    })().catch(err => {
      console.warn('Initial load failed:', err?.message || err);
      initialDataLoaded = false;
      initialLoadPromise = null;
    });
  }
  await initialLoadPromise;
}

// Flugzeuge im Luftraum abrufen
async function getAircraftInAirspace() {
  try {
    // Sicherstellen, dass First Contacts bei Serverless-Kaltstart geladen sind
    if (supabase) {
      await ensureInitialLoad();
    }
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
        const currentTime = nowHHMM();
        
        // Status bestimmen basierend auf Höhe und Geschwindigkeit
        let status = 'Vergangen';
        if (state[7] && state[7] > 0) { // Höhe über 0
          status = 'Im Luftraum';
        }
        
        // Richtung berechnen
        const direction = degreesToDirection(state[10]);
        
        // Erstkontakt / Status-Timeline verwalten (persistiert)
        let meta = firstContactData[callsignRaw];
        if (!meta) {
          meta = { firstTime: currentTime, status, direction };
          firstContactData[callsignRaw] = meta;
        }
        // Sichtung in diesem Poll
        // meta.lastSeenIso = new Date().toISOString(); // Entfernt
        // Wenn aktiv, letzte Aktivzeit aktualisieren
        if (status === 'Im Luftraum') {
          // meta.lastActiveIso = meta.lastSeenIso; // Entfernt
          if (!meta.direction || meta.direction === '-') {
            meta.direction = direction; // Richtung nur beim ersten Mal setzen
          }
        }
        // Status speichern
        const prev = meta.status;
        meta.status = status;
        // Kein Löschen mehr bei Wechsel auf Vergangen – bleibt in first_contacts
        
        if (supabase) {
          saveFirstContactToDB(callsignRaw, meta);
        } else {
          saveFirstContactData();
        }
        
        return {
          time: formatTimeForDisplay(meta.firstTime), // Erstkontakt Zeit verwenden
          callsign: callsign,
          code: callsignRaw,
          direction: direction, // Aktuelle Richtung
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
        // Als vergangen markieren (nicht löschen)
        meta.status = 'Vergangen';
        // lastActiveIso bleibt wie gesetzt, lastSeenIso bleibt letzte Sichtung
        if (supabase) {
          saveFirstContactToDB(cs, meta);
        }
      }
    }
    
    if (supabase) {
      // Alle geänderten Contacts in Supabase speichern
      for (const [callsign, data] of Object.entries(firstContactData)) {
        if (typeof data === 'object') {
          saveFirstContactToDB(callsign, data);
        }
      }
      // Regelmäßig alte Einträge bereinigen
      cleanFirstContactsDB();
    } else {
      saveFirstContactData();
    }

    // Flüge, die nicht mehr in der API sind, aber kürzlich aktiv waren, ergänzen und als "Vergangen" listen
    const augmented = aircraft
      .concat(
        Object.entries(firstContactData)
          .filter(([cs, meta]) => typeof meta === 'object')
          .filter(([cs, meta]) => {
            // nicht doppelt, wenn schon in aktueller Liste
            const exists = aircraft.some(a => a.callsign === cs);
            return meta.status === 'Vergangen' && !exists;
          })
          .map(([cs, meta]) => ({
            time: formatTimeForDisplay(meta.firstTime),
            callsign: displayNameForCallsign(cs),
            code: cs,
            direction: meta.direction || '-', // Gespeicherte Richtung verwenden
            status: 'Vergangen',
            altitude: 0,
            speed: 0,
            distance: 0
          }))
      );

    aircraft = augmented;

      // Doppelte entfernen (bevorzugt aktuelle Einträge)
      const seenCallsigns = new Set();
      aircraft = aircraft.filter(item => {
        const callsign = item.code || item.callsign;
        if (seenCallsigns.has(callsign)) {
          const existing = aircraft.find(a => (a.code || a.callsign) === callsign);
          if (existing && existing.status === 'Im Luftraum' && item.status !== 'Im Luftraum') {
            return false;
          }
        }
        seenCallsigns.add(callsign);
        return true;
      });
      // Retention: Vergangene Flüge werden nicht zeitbasiert ausgeblendet; Cleaner begrenzt DB auf letzte N
      aircraft = aircraft.sort((a, b) => {
        // Sortierung: Im Luftraum zuerst, dann nach Uhrzeit (neueste zuerst)
        if (a.status === 'Im Luftraum' && b.status !== 'Im Luftraum') return -1;
        if (a.status !== 'Im Luftraum' && b.status === 'Im Luftraum') return 1;
        const timeToMinutes = (timeStr) => {
          if (!timeStr || typeof timeStr !== 'string') return 0;
          const [hours, minutes] = timeStr.split(':').map(Number);
          return (hours || 0) * 60 + (minutes || 0);
        };
        const aMinutes = timeToMinutes(a.time);
        const bMinutes = timeToMinutes(b.time);
        return bMinutes - aMinutes;
      }).slice(0, appConfig.filtering?.maxDisplayCount || 7);

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

async function fetchAircraftSnapshotFromDB() {
  if (!supabase) return null;
  const maxPast = appConfig.data?.maxRecentPast || 7;
  try {
    // Try case-insensitive status filters first
    const [{ data: active, error: errA }, { data: past, error: errP }] = await Promise.all([
      supabase.from('first_contacts')
        .select('callsign, first_time, status, direction, display_name')
        .ilike('status', 'Im Luftraum%'),
      supabase.from('first_contacts')
        .select('callsign, first_time, status, direction, display_name')
        .ilike('status', 'Vergangen%')
        .order('first_time', { ascending: false })
        .limit(maxPast)
    ]);
    if (errA) throw errA;
    if (errP) throw errP;
    let rows = [...(active || []), ...(past || [])];

    // Fallback: if nothing returned, get latest rows regardless of status
    if (!rows || rows.length === 0) {
      const { data: anyRows, error: anyErr } = await supabase
        .from('first_contacts')
        .select('callsign, first_time, status, direction, display_name')
        .order('first_time', { ascending: false })
        .limit(maxPast);
      if (!anyErr && anyRows) rows = anyRows;
    }

    let list = rows.map(r => {
      const display = r.display_name || r.callsign;
      return {
        time: formatTimeForDisplay(r.first_time),
        callsign: display,
        code: r.callsign,
        direction: r.direction || '-',
        status: r.status,
        altitude: 0,
        speed: 0,
        distance: 0
      };
    });
    const timeToMinutes = (timeStr) => {
      if (!timeStr || typeof timeStr !== 'string') return 0;
      const [hours, minutes] = timeStr.split(':').map(Number);
      return (hours || 0) * 60 + (minutes || 0);
    };
    list = list.sort((a, b) => {
      if ((a.status || '').startsWith('Im Luftraum') && !(b.status || '').startsWith('Im Luftraum')) return -1;
      if (!(a.status || '').startsWith('Im Luftraum') && (b.status || '').startsWith('Im Luftraum')) return 1;
      return timeToMinutes(b.time) - timeToMinutes(a.time);
    }).slice(0, appConfig.filtering?.maxDisplayCount || 7);
    return list;
  } catch (e) {
    console.warn('fetchAircraftSnapshotFromDB Fehler:', e.message || e);
    return null;
  }
}

// API Endpoints
app.get('/api/aircraft', async (req, res) => {
  try {
    if (supabase) {
      await ensureInitialLoad();
    }
    if (req.query && req.query.nocache === '1') {
      cache.del('aircraft');
      cache.del('lastRequestTime');
    }

    let aircraft;
    if (supabase) {
      // Always read current snapshot from DB to keep local and prod consistent
      aircraft = await fetchAircraftSnapshotFromDB();
      if (!aircraft) aircraft = [];
    } else {
      // Fallback without Supabase
      aircraft = await getAircraftInAirspace();
    }
    
    res.json({
      title: appConfig.display.title,
      aircraft: aircraft,
      timestamp: new Date().toISOString(),
      coordinates: { lat: parseFloat(process.env.LAT) || 48.3705, lon: parseFloat(process.env.LON) || 7.8819 },
      radius: appConfig.display.radius
    });
  } catch (error) {
    console.error('API Fehler:', error);
    res.status(500).json({ error: 'Interner Server Fehler' });
  }
});

// Polling-Endpoint für Cron (aktualisiert DB, liefert kurzen Status)
app.get('/api/poll', async (req, res) => {
  try {
    const token = req.query && req.query.token;
    const expected = process.env.POLL_SECRET;
    if (expected && token !== expected) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    if (supabase) {
      await ensureInitialLoad();
    }
    cache.del('lastRequestTime');
    pollWriteCount = 0;
    pollWriteTrack = true;
    const result = await getAircraftInAirspace();
    pollWriteTrack = false;
    const snapshot = supabase ? (await fetchAircraftSnapshotFromDB()) || [] : result || [];
    lastCronPoll.timestamp = new Date().toISOString();
    lastCronPoll.found = Array.isArray(result) ? result.length : 0;
    lastCronPoll.saved = pollWriteCount;
    lastCronPoll.snapshot = Array.isArray(snapshot) ? snapshot.length : 0;
    lastCronPoll.error = null;
    res.json({ ok: true, found: lastCronPoll.found, saved: lastCronPoll.saved, snapshot: lastCronPoll.snapshot, timestamp: lastCronPoll.timestamp, writeEnabled: WRITE_ENABLED });
  } catch (e) {
    console.error('Poll Fehler:', e);
    pollWriteTrack = false;
    lastCronPoll.timestamp = new Date().toISOString();
    lastCronPoll.error = e?.message || String(e);
    res.status(500).json({ ok: false, error: lastCronPoll.error });
  }
});

// Debug endpoint for Render troubleshooting
app.get('/api/debug', (req, res) => {
  const snapshotInfo = { available: false };
  try {
    snapshotInfo.available = true;
    snapshotInfo.maxRecentPast = appConfig.data?.maxRecentPast || 7;
  } catch {}
  const debugInfo = {
    timestamp: new Date().toISOString(),
    config: appConfig,
    hasSupabaseCredentials: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    usingSupabase: !!supabase,
    writeEnabled: WRITE_ENABLED,
    cacheStats: {
      apiCache: cache.getStats(),
      tokenCache: tokenCache.getStats()
    },
    firstContactsCount: Object.keys(firstContactData).length,
    pastCount: Object.values(firstContactData).filter(m => m && (m.status || '').startsWith('Vergangen')).length,
    lastCronPoll,
    snapshotInfo,
    timeDebug: {
      currentTime: new Date().toLocaleTimeString('de-DE'),
      currentTimeISO: new Date().toISOString(),
      sampleFirstContact: Object.values(firstContactData)[0] || 'Keine Daten'
    }
  };
  
  res.json(debugInfo);
});

// Hauptseite
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server starten (nur wenn nicht in Vercel Serverless Umgebung)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚁 Luftraumüberwachung läuft auf Port ${PORT}`);
    console.log(`📍 Überwachungsgebiet: ${config.coordinates.lat}, ${config.coordinates.lon} (${config.radius}km Radius)`);
    console.log(`📺 E-Ink Display optimiert für 800x480px`);
  });
}

// Export für Vercel
module.exports = app;
