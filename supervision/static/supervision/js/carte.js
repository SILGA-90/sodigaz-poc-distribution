/* Cartographie plein écran SODIGAZ
 * window.SODIGAZ_CARTE doit être défini avant ce script (voir carte.html).
 */

const { dateFilter, livreurFilter, carteUrl, opDetailUrl } = window.SODIGAZ_CARTE;
const REFRESH_MS = 15000;

function buildFetchUrl() {
    const u = new URL(carteUrl, window.location.origin);
    u.searchParams.set('date', dateFilter);
    if (livreurFilter) u.searchParams.set('livreur', livreurFilter);
    return u.toString();
}

function opUrl(uuid) {
    return opDetailUrl.replace('00000000-0000-0000-0000-000000000000', uuid);
}

// ─── Leaflet init ─────────────────────────────────────────────────────────────
const map = L.map('carte-map').setView([12.3650, -1.5236], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
}).addTo(map);

// Recalcul de la taille après que le flex layout se stabilise
requestAnimationFrame(() => map.invalidateSize());

// ─── Icônes PLV ───────────────────────────────────────────────────────────────
function makePlvIcon(color) {
    return L.divIcon({
        className: '',
        html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);"></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9],
    });
}
const blueIcon  = makePlvIcon('#079BD9');
const greenIcon = makePlvIcon('#198754');

// ─── Couleurs par livreur ─────────────────────────────────────────────────────
const PALETTE = ['#EE7202', '#dc3545', '#6f42c1', '#0dcaf0', '#ffc107'];
const livreurColorMap = {};
let paletteIdx = 0;

function getLivreurColor(code) {
    if (!livreurColorMap[code]) {
        livreurColorMap[code] = PALETTE[paletteIdx % PALETTE.length];
        paletteIdx++;
    }
    return livreurColorMap[code];
}

function makeOpIcon(color) {
    return L.divIcon({
        className: '',
        html: `<div style="background:${color};width:10px;height:10px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7],
    });
}

// ─── State ────────────────────────────────────────────────────────────────────
const plvMarkers   = new Map();
const opMarkers    = new Map();
let   routePolylines = [];
let   showParcours   = false;

// ─── Parcours toggle ──────────────────────────────────────────────────────────
const toggleBtn = document.getElementById('carte-toggle-parcours');
toggleBtn.addEventListener('click', function () {
    if (!showParcours && routePolylines.length === 0) {
        // Aucune opération géolocalisée disponible pour tracer un parcours
        this.classList.add('btn-parcours--unavail');
        this.textContent = 'Aucun parcours disponible';
        setTimeout(() => {
            this.classList.remove('btn-parcours--unavail');
            this.innerHTML = '<i class="bi bi-signpost-split me-1"></i>Afficher parcours';
        }, 2200);
        return;
    }
    showParcours = !showParcours;
    this.innerHTML = showParcours
        ? '<i class="bi bi-signpost-split me-1"></i>Masquer parcours'
        : '<i class="bi bi-signpost-split me-1"></i>Afficher parcours';
    this.classList.toggle('active', showParcours);
    routePolylines.forEach(p => showParcours ? p.addTo(map) : map.removeLayer(p));
});

function redessinerParcours(operations) {
    routePolylines.forEach(p => map.removeLayer(p));
    routePolylines = [];
    const byLivreur = {};
    operations.forEach(op => {
        if (!byLivreur[op.livreur]) byLivreur[op.livreur] = [];
        byLivreur[op.livreur].push(op);
    });
    for (const [livreur, ops] of Object.entries(byLivreur)) {
        ops.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        if (ops.length < 2) continue;
        const color = getLivreurColor(livreur);
        const poly  = L.polyline(
            ops.map(op => [op.latitude, op.longitude]),
            { color, weight: 3, opacity: .78, dashArray: '6 8' }
        ).bindTooltip(`Parcours ${livreur}`, { sticky: true });
        if (showParcours) poly.addTo(map);
        routePolylines.push(poly);
    }
}

// ─── Mise à jour carte + stats ────────────────────────────────────────────────
function refreshCarte() {
    return fetch(buildFetchUrl(), { credentials: 'same-origin' })
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(data => {

            // PLV
            const seenPlv = new Set();
            data.plvs.forEach(plv => {
                const key  = String(plv.id);
                seenPlv.add(key);
                const icon = plv.visite ? greenIcon : blueIcon;
                const plvLabel = plv.code_plv
                    ? `<span style="font-family:monospace;font-size:.76em;color:#0670A0;background:#e3f3fb;padding:1px 5px;border-radius:3px;margin-right:4px;">${esc(plv.code_plv)}</span>${esc(plv.libelle)}`
                    : esc(plv.libelle);
                const popup = `<strong>${plvLabel}</strong>`
                    + `<br><span style="color:#8aa8c0;font-size:.78em;">${esc(plv.client)}</span>`
                    + (plv.visite
                        ? '<br><span style="color:#198754;font-weight:700;font-size:.82em;">✓ Visitée</span>'
                        : '<br><span style="color:#94a3b8;font-size:.78em;">À visiter</span>');
                if (plvMarkers.has(key)) {
                    plvMarkers.get(key).setIcon(icon).setPopupContent(popup);
                } else {
                    plvMarkers.set(key,
                        L.marker([plv.latitude, plv.longitude], { icon })
                            .bindPopup(popup).addTo(map)
                    );
                }
            });
            for (const [key, m] of plvMarkers) {
                if (!seenPlv.has(key)) { map.removeLayer(m); plvMarkers.delete(key); }
            }

            // Opérations
            const seenOp = new Set();
            data.operations.forEach(op => {
                const key   = op.uuid;
                seenOp.add(key);
                const color = getLivreurColor(op.livreur);
                const label = op.type === 'COLLECTE' ? 'Collecte' : 'Restitution';
                const popup = `<strong style="color:${color}">${esc(label)}</strong>`
                    + `<br><span style="font-size:.82em;">${esc(op.livreur)} · ${esc(op.plv)}</span>`
                    + `<br><a href="${opUrl(op.uuid)}"
                             style="font-size:.8em;color:#079BD9;font-weight:600;">
                           Voir le détail →</a>`;
                if (!opMarkers.has(key)) {
                    opMarkers.set(key,
                        L.marker([op.latitude, op.longitude], { icon: makeOpIcon(color) })
                            .bindPopup(popup).addTo(map)
                    );
                }
            });
            for (const [key, m] of opMarkers) {
                if (!seenOp.has(key)) { map.removeLayer(m); opMarkers.delete(key); }
            }

            redessinerParcours(data.operations);

            // Stats overlay
            const visitees = data.plvs.filter(p => p.visite).length;
            const total    = data.plvs.length;
            const nbOps    = data.operations.length;
            document.getElementById('stat-plv').textContent =
                `PLV visitées : ${visitees} / ${total}`;
            document.getElementById('stat-ops').textContent =
                `${nbOps} opération${nbOps !== 1 ? 's' : ''}`;
        });
}

// ─── Live indicator ───────────────────────────────────────────────────────────
const liveDot    = document.getElementById('carte-live-dot');
const liveStatus = document.getElementById('carte-live-status');
let   lastUpdateAt = Date.now();

function updateFreshness() {
    const s = Math.floor((Date.now() - lastUpdateAt) / 1000);
    let label;
    if      (s < 5)  label = "à l'instant";
    else if (s < 60) label = `il y a ${s}s`;
    else             label = `il y a ${Math.floor(s / 60)} min`;
    document.getElementById('carte-last-update').textContent = label;
}
setInterval(updateFreshness, 1000);

// ─── Polling ─────────────────────────────────────────────────────────────────
let intervalId = null;

function tick() {
    refreshCarte()
        .then(() => {
            lastUpdateAt = Date.now();
            liveDot.className = 'live-dot';
            liveStatus.textContent = 'En ligne';
        })
        .catch(() => {
            liveDot.className = 'live-dot offline';
            liveStatus.textContent = 'Hors ligne';
        });
}

function startAutoRefresh() {
    if (intervalId !== null) return;
    intervalId = setInterval(tick, REFRESH_MS);
}
function stopAutoRefresh() {
    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopAutoRefresh();
        liveDot.className = 'live-dot paused';
        liveStatus.textContent = 'En pause';
    } else {
        tick();
        startAutoRefresh();
    }
});

function esc(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

tick();
startAutoRefresh();
