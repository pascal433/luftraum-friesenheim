// E-Ink Display optimierte Luftraumüberwachung
class AirspaceMonitor {
    constructor() {
        this.updateInterval = 30000; // 30 Sekunden
        this.apiUrl = '/api/aircraft';
        this.isUpdating = false;
        
        this.init();
    }

    async init() {
        try {
            // Erste Daten laden
            await this.updateData();
            
            // Update Timer starten
            this.startUpdateTimer();
            
            // Event Listener für manuelle Updates
            document.addEventListener('keydown', (e) => {
                if (e.key === 'r' || e.key === 'R') {
                    this.updateData();
                }
            });
            
        } catch (error) {
            console.error('Initialisierungsfehler:', error);
        }
    }

    async updateData() {
        if (this.isUpdating) return;
        
        this.isUpdating = true;
        
        try {
            const response = await fetch(this.apiUrl);
            const data = await response.json();
            
            // Titel aus API übernehmen (kommt aus ENV/server)
            if (data && data.title) {
                const header = document.getElementById('header-title');
                if (header) header.textContent = String(data.title).toUpperCase();
            }

            this.updateDisplay(data);
            
        } catch (error) {
            console.error('Update Fehler:', error);
        } finally {
            this.isUpdating = false;
        }
    }

    updateDisplay(data) {
        const tbody = document.getElementById('aircraft-tbody');
        const noAircraft = document.getElementById('no-aircraft');
        
        if (!data || !Array.isArray(data.aircraft) || data.aircraft.length === 0) {
            // Keine Flugzeuge
            tbody.innerHTML = '';
            noAircraft.style.display = 'flex';
            return;
        }
        
        // Flugzeuge anzeigen
        noAircraft.style.display = 'none';
        
        // Tabelle aktualisieren (E-Ink optimiert - minimale DOM Änderungen)
        const newRows = data.aircraft.map(aircraft => {
            const row = document.createElement('tr');
            
            const timeCell = document.createElement('td');
            timeCell.textContent = aircraft.time;
            
            const callsignCell = document.createElement('td');
            callsignCell.textContent = aircraft.callsign;
            
            const directionCell = document.createElement('td');
            directionCell.textContent = aircraft.direction;
            directionCell.className = 'direction-cell';
            
            const statusCell = document.createElement('td');
            statusCell.textContent = aircraft.status;
            statusCell.className = aircraft.status === 'Im Luftraum' ? 'status-active' : 'status-past';
            
            row.appendChild(timeCell);
            row.appendChild(callsignCell);
            row.appendChild(directionCell);
            row.appendChild(statusCell);
            
            return row;
        });
        
        // DOM effizient aktualisieren
        tbody.innerHTML = '';
        newRows.forEach(row => tbody.appendChild(row));
    }




    startUpdateTimer() {
        setInterval(() => {
            this.updateData();
        }, this.updateInterval);
    }
}

// E-Ink Display Optimierungen
class EInkOptimizer {
    constructor() {
        this.init();
    }

    init() {
        // Minimale Animationen für E-Ink
        this.disableAnimations();
        
        // Touch Events für E-Ink Display
        this.setupTouchEvents();
        
        // Farboptimierungen
        this.optimizeColors();
    }

    disableAnimations() {
        // CSS für minimale Animationen
        const style = document.createElement('style');
        style.textContent = `
            * {
                animation-duration: 0.1s !important;
                transition-duration: 0.1s !important;
            }
            
            .aircraft-table tbody tr {
                animation: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    setupTouchEvents() {
        // Touch Events für manuelle Updates
        let touchStartY = 0;
        
        document.addEventListener('touchstart', (e) => {
            touchStartY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchend', (e) => {
            const touchEndY = e.changedTouches[0].clientY;
            const diff = touchStartY - touchEndY;
            
            // Swipe nach oben für Update
            if (diff > 50) {
                window.airspaceMonitor.updateData();
            }
        });
    }

    optimizeColors() {
        // Zusätzliche Farboptimierungen für E-Ink
        const style = document.createElement('style');
        style.textContent = `
            /* E-Ink Farboptimierungen */
            body {
                -webkit-font-smoothing: none;
                -moz-osx-font-smoothing: none;
                font-smooth: never;
            }
            
            /* Stark kontrastige Farben */
            .status-active {
                color: #00ff00 !important;
                text-shadow: none;
            }
            
            .status-past {
                color: #666666 !important;
                text-shadow: none;
            }
        `;
        document.head.appendChild(style);
    }
}

// Initialisierung wenn DOM geladen
document.addEventListener('DOMContentLoaded', () => {
    // E-Ink Optimierungen
    window.eInkOptimizer = new EInkOptimizer();
    
    // Luftraumüberwachung starten
    window.airspaceMonitor = new AirspaceMonitor();
    
    // Vollbildmodus für E-Ink Display
    if (document.documentElement.requestFullscreen) {
        // Automatischer Vollbildmodus (optional)
        // document.documentElement.requestFullscreen();
    }
});

// Service Worker für Offline-Funktionalität (optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registriert:', registration);
            })
            .catch(error => {
                console.log('SW Registrierungsfehler:', error);
            });
    });
}
