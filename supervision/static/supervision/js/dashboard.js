/* Supervision SODIGAZ — Dashboard : polling, carte Leaflet, bilan produits
 *
 * Les URLs Django et la date active sont injectées dans window.SODIGAZ_DASH
 * par un petit bloc <script> inline dans dashboard.html, AVANT ce fichier.
 */

const { dateFilter, carteUrl, statsUrl, bilanUrl } = window.SODIGAZ_DASH;
const REFRESH_INTERVAL_MS = 15000;
const CARTE_URL = `${carteUrl}?date=${dateFilter}`;
const STATS_URL = `${statsUrl}?date=${dateFilter}`;
const BILAN_URL = `${bilanUrl}?date=${dateFilter}`;

// Références UI
const liveDot    = document.getElementById('live-dot');
const liveStatus = document.getElementById('live-status');

// =============================================================================
// Bilan produits du jour
// =============================================================================
function refreshBilanProduits() {
    return fetch(BILAN_URL, { credentials: 'same-origin' })
        .then(r => r.json())
        .then(d => {
            const tbodyC = document.getElementById('bilanCollecteTbody');
            const tbodyR = document.getElementById('bilanRestitutionTbody');
            const vide2  = '<tr><td colspan="2" class="bilan-loading">Aucune donnée</td></tr>';
            const vide4  = '<tr><td colspan="4" class="bilan-loading">Aucune donnée</td></tr>';

            if (!d.collecte || d.collecte.length === 0) {
                tbodyC.innerHTML = vide2;
            } else {
                const totalC = d.collecte.reduce((s, p) => s + p.realise, 0);
                tbodyC.innerHTML = d.collecte.map(p =>
                    `<tr>
                        <td><span class="bilan-code-x3">${escapeHtml(p.code_x3)}</span>${escapeHtml(p.libelle)}</td>
                        <td class="fw-semibold">${p.realise}</td>
                    </tr>`
                ).join('') +
                `<tr class="bilan-total-collecte">
                    <td>Total collecté</td>
                    <td>${totalC}</td>
                </tr>`;
            }

            if (!d.restitution || d.restitution.length === 0) {
                tbodyR.innerHTML = vide4;
            } else {
                const totalR = d.restitution.reduce((s, p) => s + p.realise, 0);
                tbodyR.innerHTML = d.restitution.map(p => {
                    const sign = p.ecart >= 0 ? '+' : '';
                    const cls  = p.ecart < 0 ? 'bilan-ecart-neg'
                               : p.ecart > 0 ? 'bilan-ecart-pos'
                               : 'bilan-ecart-nul';
                    const mont = p.montant > 0
                        ? `<span class="bilan-montant-sm">${p.montant.toLocaleString('fr-FR')} F</span>`
                        : '';
                    return `<tr>
                        <td><span class="bilan-code-x3">${escapeHtml(p.code_x3)}</span>${escapeHtml(p.libelle)}${mont}</td>
                        <td class="text-muted">${p.prevu}</td>
                        <td class="fw-semibold">${p.realise}</td>
                        <td class="${cls}">${sign}${p.ecart}</td>
                    </tr>`;
                }).join('') +
                `<tr class="bilan-total-restit">
                    <td colspan="2">Total restitué</td>
                    <td>${totalR}</td>
                    <td></td>
                </tr>`;
            }
        });
}

// =============================================================================
// Carte Leaflet
// =============================================================================
const map = L.map('map').setView([12.3650, -1.5236], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
}).addTo(map);

const blueIcon = L.divIcon({
    className: '',
    html: '<div style="background:#1a7fba;width:14px;height:14px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);"></div>',
    iconSize: [18, 18], iconAnchor: [9, 9],
});
const greenIcon = L.divIcon({
    className: '',
    html: '<div style="background:#198754;width:14px;height:14px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);"></div>',
    iconSize: [18, 18], iconAnchor: [9, 9],
});
const opIcon = L.divIcon({
    className: '',
    html: '<div style="background:#f47920;width:10px;height:10px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.25);"></div>',
    iconSize: [14, 14], iconAnchor: [7, 7],
});

const plvMarkers  = new Map();
const opMarkers   = new Map();
let routePolylines = [];
let showParcours   = false;
const LIVREUR_COLORS = ['#1a7fba', '#dc3545', '#198754', '#f47920', '#6f42c1'];

const toggleBtn = document.getElementById('toggleParcours');
toggleBtn.addEventListener('click', function () {
    showParcours = !showParcours;
    const parcoursMsg = document.getElementById('parcours-msg');

    if (showParcours && routePolylines.length === 0) {
        showParcours = false;
        parcoursMsg.textContent = "Aucun parcours — synchronisez d'abord des opérations.";
        parcoursMsg.style.display = '';
        setTimeout(() => { parcoursMsg.style.display = 'none'; }, 5000);
        return;
    }

    parcoursMsg.style.display = 'none';
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
    let colorIdx = 0;
    for (const [livreur, ops] of Object.entries(byLivreur)) {
        ops.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        if (ops.length < 2) { colorIdx++; continue; }
        const color = LIVREUR_COLORS[colorIdx % LIVREUR_COLORS.length];
        const latlngs = ops.map(op => [op.latitude, op.longitude]);
        const poly = L.polyline(latlngs, { color, weight: 3, opacity: .75, dashArray: '6 8' })
            .bindTooltip(`Parcours ${livreur}`, { permanent: false, sticky: true });
        if (showParcours) poly.addTo(map);
        routePolylines.push(poly);
        colorIdx++;
    }
}

function refreshCarte() {
    return fetch(CARTE_URL, { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
            const seenPlvIds = new Set();
            data.plvs.forEach(plv => {
                const key  = String(plv.id);
                seenPlvIds.add(key);
                const icon  = plv.visite ? greenIcon : blueIcon;
                const popup = `<strong>${escapeHtml(plv.libelle)}</strong><br>${escapeHtml(plv.client)}`
                    + (plv.visite ? '<br><em style="color:#198754">Visitée aujourd\'hui</em>' : '');
                if (plvMarkers.has(key)) {
                    plvMarkers.get(key).setIcon(icon).setPopupContent(popup);
                } else {
                    plvMarkers.set(key, L.marker([plv.latitude, plv.longitude], { icon })
                        .bindPopup(popup).addTo(map));
                }
            });
            for (const [key, m] of plvMarkers) {
                if (!seenPlvIds.has(key)) { map.removeLayer(m); plvMarkers.delete(key); }
            }

            const seenOpUuids = new Set();
            data.operations.forEach(op => {
                const key = op.uuid;
                seenOpUuids.add(key);
                const typeColor = op.type === 'COLLECTE' ? '#1a7fba' : '#198754';
                const popup = `<strong style="color:${typeColor}">${escapeHtml(op.type)}</strong>`
                    + `<br>Livreur ${escapeHtml(op.livreur)}<br>PLV : ${escapeHtml(op.plv)}`;
                if (opMarkers.has(key)) {
                    opMarkers.get(key).setPopupContent(popup);
                } else {
                    opMarkers.set(key, L.marker([op.latitude, op.longitude], { icon: opIcon })
                        .bindPopup(popup).addTo(map));
                }
            });
            for (const [key, m] of opMarkers) {
                if (!seenOpUuids.has(key)) { map.removeLayer(m); opMarkers.delete(key); }
            }

            redessinerParcours(data.operations);
        });
}

// =============================================================================
// Stats KPI
// =============================================================================
function refreshStats() {
    return fetch(STATS_URL, { credentials: 'same-origin' })
        .then(r => r.json())
        .then(stats => {
            for (const [key, value] of Object.entries(stats)) {
                const el = document.querySelector(`[data-stat="${key}"]`);
                if (el) {
                    const formatted = (key === 'montant_encaisse')
                        ? Math.round(value).toLocaleString('fr-FR')
                        : value;
                    if (el.textContent.trim() !== String(formatted)) {
                        el.textContent = formatted;
                        el.classList.remove('stat-updated');
                        void el.offsetWidth;
                        el.classList.add('stat-updated');
                    }
                }
            }
            const link = document.getElementById('anomalies-link');
            if (link) link.style.display = stats.nb_anomalies_ouvertes > 0 ? '' : 'none';
            const kpiAnom = document.getElementById('kpi-anomalies');
            if (kpiAnom) kpiAnom.classList.toggle('kpi-card-danger', stats.nb_anomalies_elevees > 0);
        });
}

// =============================================================================
// Fraîcheur de l'indicateur
// =============================================================================
let lastUpdateAt = Date.now();

function updateFreshnessIndicator() {
    const s = Math.floor((Date.now() - lastUpdateAt) / 1000);
    let label;
    if (s < 5)        label = "à l'instant";
    else if (s < 60)  label = `il y a ${s}s`;
    else              label = `il y a ${Math.floor(s / 60)} min`;
    document.getElementById('last-update').textContent = label;
}
setInterval(updateFreshnessIndicator, 1000);

// =============================================================================
// Cycle de rafraîchissement (pause auto sur onglet inactif)
// =============================================================================
function tick() {
    Promise.all([refreshCarte(), refreshStats(), refreshBilanProduits()])
        .then(() => {
            lastUpdateAt = Date.now();
            liveDot.className = 'live-dot';
            liveStatus.textContent = 'En ligne';
        })
        .catch(err => {
            console.warn('Refresh échoué :', err);
            liveDot.className = 'live-dot offline';
            liveStatus.textContent = 'Hors ligne';
        });
}

let intervalId = null;
function startAutoRefresh() {
    if (intervalId !== null) return;
    intervalId = setInterval(tick, REFRESH_INTERVAL_MS);
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

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Démarrage
tick();
startAutoRefresh();
