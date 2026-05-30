#!/bin/bash
# =============================================================================
# Amelioration de la supervision : refresh intelligent sans reload
#   - endpoint /supervision/api/stats/ pour les 4 KPI
#   - rafraichissement Leaflet sans flash, zoom preserve
#   - indicateur de fraicheur des donnees
#   - pause automatique quand l'onglet n'est pas actif
# Usage : depuis ~/sodigaz_poc, bash install_supervision_live.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : ce script doit etre execute depuis ~/sodigaz_poc"
    exit 1
fi

# =============================================================================
echo ""
echo "=== Etape 1 : ajout du endpoint /api/stats/ ==="

# On insere une nouvelle vue dashboard_stats_data dans supervision/views.py
# juste apres dashboard_carte_data. Pour rester idempotent, on detecte d'abord
# si la fonction existe deja.

if grep -q "def dashboard_stats_data" supervision/views.py; then
    echo "  = dashboard_stats_data deja present"
else
    python3 << 'PYEOF'
from pathlib import Path

views_path = Path("supervision/views.py")
content = views_path.read_text()

# Nouvelle vue stats : a inserer apres dashboard_carte_data
new_view = '''

@superviseur_required
def dashboard_stats_data(request):
    """
    Endpoint AJAX : renvoie les 4 KPI du dashboard.
    Permet la mise a jour sans recharger toute la page.
    """
    today = date_cls.today()

    programmes_aujourdhui = Programme.objects.filter(
        date_programme=today, is_deleted=False,
    )
    nb_programmes = programmes_aujourdhui.count()
    nb_programmes_en_cours = programmes_aujourdhui.filter(statut="EN_COURS").count()
    nb_programmes_clotures = programmes_aujourdhui.filter(statut="CLOTURE").count()

    operations_aujourdhui = Operation.objects.filter(
        etape__programme__date_programme=today,
        is_deleted=False,
    )
    nb_operations = operations_aujourdhui.count()
    montant_encaisse = float(
        operations_aujourdhui.aggregate(total=Sum("montant_encaisse"))["total"] or 0
    )

    nb_anomalies_ouvertes = Anomalie.objects.filter(
        programme__date_programme=today,
        statut=StatutAnomalie.OUVERTE,
        is_deleted=False,
    ).count()

    return JsonResponse({
        "nb_programmes": nb_programmes,
        "nb_programmes_en_cours": nb_programmes_en_cours,
        "nb_programmes_clotures": nb_programmes_clotures,
        "nb_operations": nb_operations,
        "montant_encaisse": montant_encaisse,
        "nb_anomalies_ouvertes": nb_anomalies_ouvertes,
    })
'''

# Insertion juste apres la fonction dashboard_carte_data
# (qui se termine par un "return JsonResponse" suivi de )
import re
pattern = r'(def dashboard_carte_data.*?return JsonResponse\(\{"plvs": plvs, "operations": operations\}\))'
content = re.sub(pattern, r'\1\n' + new_view, content, count=1, flags=re.DOTALL)

views_path.write_text(content)
print("  + dashboard_stats_data ajoutee a supervision/views.py")
PYEOF
fi

# =============================================================================
echo ""
echo "=== Etape 2 : ajout de la route ==="

if grep -q "api/stats" supervision/urls.py; then
    echo "  = route api/stats deja presente"
else
    python3 << 'PYEOF'
from pathlib import Path
urls_path = Path("supervision/urls.py")
content = urls_path.read_text()
content = content.replace(
    'path("api/carte/", views.dashboard_carte_data, name="carte-data"),',
    'path("api/carte/", views.dashboard_carte_data, name="carte-data"),\n'
    '    path("api/stats/", views.dashboard_stats_data, name="stats-data"),',
)
urls_path.write_text(content)
print("  + route /api/stats/ ajoutee")
PYEOF
fi

# =============================================================================
echo ""
echo "=== Etape 3 : reecriture du template dashboard.html ==="

cat > supervision/templates/supervision/dashboard.html << 'TPLEOF'
{% extends "supervision/base.html" %}
{% block title %}Tableau de bord{% endblock %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-4">
    <h1 class="h3">Tableau de bord - {{ today|date:"l j F Y" }}</h1>
    <div class="text-end">
        <span class="badge bg-success" id="status-indicator">
            <span class="status-dot">&#9679;</span> Connecte
        </span>
        <div class="small text-muted mt-1">
            Mis a jour <span id="last-update">a l'instant</span>
        </div>
    </div>
</div>

<div class="row g-3 mb-4">
    <div class="col-md-3">
        <div class="card stat-card h-100">
            <div class="card-body">
                <div class="text-muted small">Programmes du jour</div>
                <div class="display-6" data-stat="nb_programmes">{{ nb_programmes }}</div>
                <div class="small">
                    <span data-stat="nb_programmes_en_cours">{{ nb_programmes_en_cours }}</span> en cours,
                    <span data-stat="nb_programmes_clotures">{{ nb_programmes_clotures }}</span> clotures
                </div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card stat-card success h-100">
            <div class="card-body">
                <div class="text-muted small">Operations realisees</div>
                <div class="display-6" data-stat="nb_operations">{{ nb_operations }}</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card stat-card success h-100">
            <div class="card-body">
                <div class="text-muted small">Montant encaisse</div>
                <div class="display-6" data-stat="montant_encaisse">{{ montant_encaisse|floatformat:0 }}</div>
                <div class="small">FCFA</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card stat-card danger h-100">
            <div class="card-body">
                <div class="text-muted small">Anomalies ouvertes</div>
                <div class="display-6" data-stat="nb_anomalies_ouvertes">{{ nb_anomalies_ouvertes }}</div>
                <a href="{% url 'supervision:anomalies' %}" class="small" id="anomalies-link"
                   style="{% if nb_anomalies_ouvertes == 0 %}display:none{% endif %}">Voir &raquo;</a>
            </div>
        </div>
    </div>
</div>

<div class="card">
    <div class="card-body">
        <h5 class="card-title">Cartographie des PLV et operations du jour</h5>
        <div id="map"></div>
    </div>
</div>

<style>
    .status-dot { font-size: 0.8em; }
    @keyframes pulse-update {
        0% { background-color: #ffeaa7; }
        100% { background-color: transparent; }
    }
    .stat-updated { animation: pulse-update 1.2s ease-out; }
</style>
{% endblock %}

{% block scripts %}
<script>
// =============================================================================
// Configuration
// =============================================================================
const REFRESH_INTERVAL_MS = 15000;  // 15 secondes
const CARTE_URL = "{% url 'supervision:carte-data' %}";
const STATS_URL = "{% url 'supervision:stats-data' %}";

// =============================================================================
// Carte Leaflet
// =============================================================================
const map = L.map('map').setView([12.3650, -1.5236], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
}).addTo(map);

const blueIcon = L.divIcon({
    className: 'plv-icon',
    html: '<div style="background:#0d6efd;width:14px;height:14px;border-radius:50%;border:2px solid white;"></div>',
    iconSize: [18, 18],
});
const greenIcon = L.divIcon({
    className: 'op-icon',
    html: '<div style="background:#198754;width:14px;height:14px;border-radius:50%;border:2px solid white;"></div>',
    iconSize: [18, 18],
});

// Cache des marqueurs deja affiches, indexe par cle stable
// (id du PLV ou uuid de l'operation).
// Cela permet d'identifier ce qui est nouveau, modifie, ou disparu.
const plvMarkers = new Map();
const opMarkers = new Map();

function refreshCarte() {
    return fetch(CARTE_URL, { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
            // ----- PLV -----
            const seenPlvIds = new Set();
            data.plvs.forEach(plv => {
                const key = String(plv.id);
                seenPlvIds.add(key);
                const popup = '<strong>' + escapeHtml(plv.libelle) + '</strong><br>' +
                              escapeHtml(plv.client);
                if (plvMarkers.has(key)) {
                    // Maj du popup si change (le PLV peut avoir change de libelle)
                    plvMarkers.get(key).setPopupContent(popup);
                } else {
                    const m = L.marker([plv.latitude, plv.longitude], { icon: blueIcon })
                        .bindPopup(popup)
                        .addTo(map);
                    plvMarkers.set(key, m);
                }
            });
            // Retirer ceux qui ont disparu
            for (const [key, marker] of plvMarkers.entries()) {
                if (!seenPlvIds.has(key)) {
                    map.removeLayer(marker);
                    plvMarkers.delete(key);
                }
            }

            // ----- OPERATIONS -----
            const seenOpUuids = new Set();
            data.operations.forEach(op => {
                const key = op.uuid;
                seenOpUuids.add(key);
                const popup =
                    '<strong>' + escapeHtml(op.type) + '</strong><br>' +
                    'Livreur ' + escapeHtml(op.livreur) + '<br>' +
                    'PLV : ' + escapeHtml(op.plv);
                if (opMarkers.has(key)) {
                    opMarkers.get(key).setPopupContent(popup);
                } else {
                    const m = L.marker([op.latitude, op.longitude], { icon: greenIcon })
                        .bindPopup(popup)
                        .addTo(map);
                    opMarkers.set(key, m);
                }
            });
            for (const [key, marker] of opMarkers.entries()) {
                if (!seenOpUuids.has(key)) {
                    map.removeLayer(marker);
                    opMarkers.delete(key);
                }
            }
        });
}

// =============================================================================
// Stats (KPI en haut)
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
                        void el.offsetWidth;  // force reflow pour rejouer l'animation
                        el.classList.add('stat-updated');
                    }
                }
            }
            // Lien anomalies : visible seulement si > 0
            const link = document.getElementById('anomalies-link');
            if (link) {
                link.style.display = stats.nb_anomalies_ouvertes > 0 ? '' : 'none';
            }
        });
}

// =============================================================================
// Indicateur de fraicheur
// =============================================================================
let lastUpdateAt = Date.now();
function updateFreshnessIndicator() {
    const secondsAgo = Math.floor((Date.now() - lastUpdateAt) / 1000);
    let label;
    if (secondsAgo < 5) label = "a l'instant";
    else if (secondsAgo < 60) label = `il y a ${secondsAgo}s`;
    else label = `il y a ${Math.floor(secondsAgo / 60)} min`;
    document.getElementById('last-update').textContent = label;
}
setInterval(updateFreshnessIndicator, 1000);

// =============================================================================
// Cycle de rafraichissement avec pause auto sur onglet inactif
// =============================================================================
const indicator = document.getElementById('status-indicator');

function tick() {
    Promise.all([refreshCarte(), refreshStats()])
        .then(() => {
            lastUpdateAt = Date.now();
            indicator.className = 'badge bg-success';
            indicator.innerHTML = '<span class="status-dot">&#9679;</span> Connecte';
        })
        .catch(err => {
            console.warn('Refresh echoue :', err);
            indicator.className = 'badge bg-warning text-dark';
            indicator.innerHTML = '<span class="status-dot">&#9679;</span> Hors ligne';
        });
}

let intervalId = null;
function startAutoRefresh() {
    if (intervalId !== null) return;
    intervalId = setInterval(tick, REFRESH_INTERVAL_MS);
}
function stopAutoRefresh() {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

// API Page Visibility : on coupe le polling quand l'onglet est cache,
// on le reactive (avec un tick immediat) au retour.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopAutoRefresh();
        indicator.className = 'badge bg-secondary';
        indicator.innerHTML = '<span class="status-dot">&#9679;</span> En pause';
    } else {
        tick();
        startAutoRefresh();
    }
});

// Helpers
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Demarrage : premier appel immediat puis cycle
tick();
startAutoRefresh();
</script>
{% endblock %}
TPLEOF

echo "OK"

# =============================================================================
echo ""
echo "=============================================="
echo "AMELIORATIONS LIVE INSTALLEES."
echo "=============================================="
echo ""
echo "Redemarre le serveur (Ctrl+C puis 'python manage.py runserver')."
echo "Va sur http://localhost:8000/supervision/"
echo ""
echo "Test : ouvre la console du navigateur (F12) et observe :"
echo "  - les requetes /api/carte/ et /api/stats/ toutes les 15s"
echo "  - l'indicateur 'Mis a jour il y a Xs' qui s'incremente"
echo "  - le badge 'Connecte' qui devient 'En pause' si tu changes d'onglet"
echo "  - les stats qui flashent en jaune au moment du changement"
echo ""
