#!/bin/bash
# =============================================================================
# Installation de l'interface web de supervision logistique
# Usage : depuis ~/sodigaz_poc avec le venv active, bash install_supervision.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : ce script doit etre execute depuis ~/sodigaz_poc"
    exit 1
fi

if [ -z "$VIRTUAL_ENV" ]; then
    echo "ERREUR : active d'abord le venv avec 'source venv/bin/activate'"
    exit 1
fi

# =============================================================================
echo ""
echo "=== Etape 1 : creation de l'app supervision ==="
mkdir -p supervision/migrations supervision/templates/supervision supervision/templatetags
touch supervision/__init__.py
touch supervision/migrations/__init__.py
touch supervision/templatetags/__init__.py

cat > supervision/apps.py << 'PYEOF'
from django.apps import AppConfig


class SupervisionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "supervision"
    verbose_name = "Supervision logistique"
PYEOF

# =============================================================================
# supervision/decorators.py
# =============================================================================
cat > supervision/decorators.py << 'PYEOF'
"""Decorateurs d'autorisation pour la supervision."""
from functools import wraps

from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied


def superviseur_required(view_func):
    """
    Restreint l'acces aux comptes de role SUPERVISEUR ou ADMIN (ou superuser).
    Un livreur connecte est rejete avec un 403.
    """
    @wraps(view_func)
    @login_required(login_url="supervision:login")
    def wrapped(request, *args, **kwargs):
        u = request.user
        if u.is_superuser or u.role in ("SUPERVISEUR", "ADMIN"):
            return view_func(request, *args, **kwargs)
        raise PermissionDenied("Cette interface est reservee aux superviseurs.")
    return wrapped
PYEOF

# =============================================================================
# supervision/views.py
# =============================================================================
cat > supervision/views.py << 'PYEOF'
"""Vues de l'interface de supervision logistique."""
from datetime import date as date_cls

from django.contrib.auth import logout as django_logout
from django.db.models import Count, Q, Sum
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render

from accounts.models import Role, Utilisateur
from distribution.models import (
    Anomalie,
    Etape,
    LigneOperation,
    LigneProgramme,
    Operation,
    Plv,
    Programme,
    StatutAnomalie,
    StatutVisite,
)

from .decorators import superviseur_required


@superviseur_required
def dashboard(request):
    """
    Page d'accueil : carte de Ouaga + statistiques du jour.
    """
    today = date_cls.today()

    programmes_aujourdhui = Programme.objects.filter(
        date_programme=today, is_deleted=False,
    ).select_related("utilisateur", "vehicule")

    nb_programmes = programmes_aujourdhui.count()
    nb_programmes_en_cours = programmes_aujourdhui.filter(statut="EN_COURS").count()
    nb_programmes_clotures = programmes_aujourdhui.filter(statut="CLOTURE").count()

    operations_aujourdhui = Operation.objects.filter(
        etape__programme__date_programme=today,
        is_deleted=False,
    )
    nb_operations = operations_aujourdhui.count()
    montant_encaisse = (
        operations_aujourdhui.aggregate(total=Sum("montant_encaisse"))["total"] or 0
    )

    nb_anomalies_ouvertes = Anomalie.objects.filter(
        programme__date_programme=today,
        statut=StatutAnomalie.OUVERTE,
        is_deleted=False,
    ).count()

    context = {
        "today": today,
        "nb_programmes": nb_programmes,
        "nb_programmes_en_cours": nb_programmes_en_cours,
        "nb_programmes_clotures": nb_programmes_clotures,
        "nb_operations": nb_operations,
        "montant_encaisse": montant_encaisse,
        "nb_anomalies_ouvertes": nb_anomalies_ouvertes,
    }
    return render(request, "supervision/dashboard.html", context)


@superviseur_required
def dashboard_carte_data(request):
    """
    Endpoint AJAX : renvoie les PLV et operations du jour au format GeoJSON-ish.
    Appele par la carte Leaflet.
    """
    today = date_cls.today()

    plvs = []
    for plv in Plv.objects.filter(statut="ACTIF").select_related("client"):
        plvs.append({
            "id": plv.id,
            "libelle": plv.libelle,
            "client": plv.client.raison_sociale,
            "latitude": plv.localisation.y,
            "longitude": plv.localisation.x,
        })

    operations = []
    for op in Operation.objects.filter(
        etape__programme__date_programme=today,
        is_deleted=False,
        localisation_saisie__isnull=False,
    ).select_related("etape__plv", "etape__programme__utilisateur"):
        operations.append({
            "uuid": str(op.uuid),
            "plv": op.etape.plv.libelle,
            "livreur": op.etape.programme.utilisateur.code_livreur,
            "type": op.type_operation,
            "latitude": op.localisation_saisie.y,
            "longitude": op.localisation_saisie.x,
        })

    return JsonResponse({"plvs": plvs, "operations": operations})


@superviseur_required
def programmes_list(request):
    today = date_cls.today()
    date_str = request.GET.get("date")
    if date_str:
        try:
            from datetime import datetime
            date_filter = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            date_filter = today
    else:
        date_filter = today

    programmes = (
        Programme.objects
        .filter(date_programme=date_filter, is_deleted=False)
        .select_related("utilisateur", "vehicule")
        .annotate(
            total_etapes=Count("etapes", filter=Q(etapes__is_deleted=False)),
            etapes_visitees=Count(
                "etapes",
                filter=Q(etapes__is_deleted=False, etapes__statut_visite=StatutVisite.VISITEE),
            ),
        )
        .order_by("type_programme", "utilisateur__code_livreur")
    )

    return render(request, "supervision/programmes_list.html", {
        "programmes": programmes,
        "date_filter": date_filter,
    })


@superviseur_required
def programme_detail(request, programme_id):
    programme = get_object_or_404(
        Programme.objects.select_related("utilisateur", "vehicule"),
        id=programme_id, is_deleted=False,
    )

    etapes = (
        programme.etapes
        .filter(is_deleted=False)
        .select_related("plv", "plv__client")
        .prefetch_related("operations__lignes__produit", "lignes_prevues__produit")
        .order_by("ordre_prevu")
    )

    # Reconciliation prevu / realise par etape et produit
    reconciliation = []
    for etape in etapes:
        # Agreger par produit
        produits_dict = {}
        for lp in etape.lignes_prevues.filter(is_deleted=False):
            produits_dict[lp.produit_id] = {
                "produit": lp.produit,
                "prevu": lp.quantite_prevue,
                "realise": 0,
            }
        for op in etape.operations.filter(is_deleted=False):
            for lo in op.lignes.filter(is_deleted=False):
                if lo.produit_id in produits_dict:
                    produits_dict[lo.produit_id]["realise"] += lo.quantite_realisee
                else:
                    produits_dict[lo.produit_id] = {
                        "produit": lo.produit,
                        "prevu": 0,
                        "realise": lo.quantite_realisee,
                    }
        lignes_recon = []
        for d in produits_dict.values():
            d["ecart"] = d["realise"] - d["prevu"]
            lignes_recon.append(d)
        reconciliation.append({"etape": etape, "lignes": lignes_recon})

    return render(request, "supervision/programme_detail.html", {
        "programme": programme,
        "reconciliation": reconciliation,
    })


@superviseur_required
def operations_list(request):
    today = date_cls.today()
    date_str = request.GET.get("date")
    livreur_code = request.GET.get("livreur", "").strip()

    if date_str:
        try:
            from datetime import datetime
            date_filter = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            date_filter = today
    else:
        date_filter = today

    operations = (
        Operation.objects
        .filter(etape__programme__date_programme=date_filter, is_deleted=False)
        .select_related(
            "etape__plv__client",
            "etape__programme__utilisateur",
        )
        .order_by("-date_heure")
    )
    if livreur_code:
        operations = operations.filter(
            etape__programme__utilisateur__code_livreur=livreur_code
        )

    livreurs = Utilisateur.objects.filter(role=Role.LIVREUR, is_active=True).order_by("code_livreur")

    return render(request, "supervision/operations_list.html", {
        "operations": operations,
        "date_filter": date_filter,
        "livreur_code": livreur_code,
        "livreurs": livreurs,
    })


@superviseur_required
def anomalies_list(request):
    statut_filter = request.GET.get("statut", "OUVERTE")
    anomalies_qs = (
        Anomalie.objects
        .filter(is_deleted=False)
        .select_related("programme__utilisateur", "plv__client")
        .order_by("-date_heure")
    )
    if statut_filter and statut_filter != "TOUS":
        anomalies_qs = anomalies_qs.filter(statut=statut_filter)

    return render(request, "supervision/anomalies_list.html", {
        "anomalies": anomalies_qs,
        "statut_filter": statut_filter,
    })


def logout_view(request):
    django_logout(request)
    return redirect("supervision:login")
PYEOF

# =============================================================================
# supervision/urls.py
# =============================================================================
cat > supervision/urls.py << 'PYEOF'
from django.contrib.auth.views import LoginView
from django.urls import path

from . import views

app_name = "supervision"

urlpatterns = [
    path("login/", LoginView.as_view(
        template_name="supervision/login.html",
        redirect_authenticated_user=True,
    ), name="login"),
    path("logout/", views.logout_view, name="logout"),

    path("", views.dashboard, name="dashboard"),
    path("api/carte/", views.dashboard_carte_data, name="carte-data"),
    path("programmes/", views.programmes_list, name="programmes"),
    path("programmes/<int:programme_id>/", views.programme_detail, name="programme-detail"),
    path("operations/", views.operations_list, name="operations"),
    path("anomalies/", views.anomalies_list, name="anomalies"),
]
PYEOF

# =============================================================================
# Templates
# =============================================================================
echo ""
echo "=== Etape 2 : creation des templates ==="

# ----- base.html -----
cat > supervision/templates/supervision/base.html << 'TPLEOF'
{% load static %}
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{% block title %}Supervision SODIGAZ{% endblock %}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <style>
        .navbar-brand { font-weight: 600; }
        .stat-card { border-left: 4px solid #0d6efd; }
        .stat-card.warning { border-left-color: #ffc107; }
        .stat-card.danger { border-left-color: #dc3545; }
        .stat-card.success { border-left-color: #198754; }
        #map { height: 500px; border-radius: 0.375rem; }
        .badge-statut-PLANIFIE { background-color: #6c757d; }
        .badge-statut-EN_COURS { background-color: #0d6efd; }
        .badge-statut-CLOTURE { background-color: #198754; }
        .badge-statut-OUVERTE { background-color: #dc3545; }
        .badge-statut-EN_TRAITEMENT { background-color: #ffc107; color: #000; }
        .badge-statut-RESOLUE { background-color: #198754; }
        .ecart-positif { color: #198754; font-weight: 600; }
        .ecart-negatif { color: #dc3545; font-weight: 600; }
        .ecart-nul { color: #6c757d; }
    </style>
</head>
<body class="bg-light">
{% if user.is_authenticated %}
<nav class="navbar navbar-expand-lg navbar-dark bg-primary">
    <div class="container-fluid">
        <a class="navbar-brand" href="{% url 'supervision:dashboard' %}">Supervision SODIGAZ</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
            <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav me-auto">
                <li class="nav-item"><a class="nav-link" href="{% url 'supervision:dashboard' %}">Tableau de bord</a></li>
                <li class="nav-item"><a class="nav-link" href="{% url 'supervision:programmes' %}">Programmes</a></li>
                <li class="nav-item"><a class="nav-link" href="{% url 'supervision:operations' %}">Operations</a></li>
                <li class="nav-item"><a class="nav-link" href="{% url 'supervision:anomalies' %}">Anomalies</a></li>
            </ul>
            <ul class="navbar-nav">
                <li class="nav-item">
                    <span class="navbar-text me-3">{{ user.get_full_name|default:user.username }} ({{ user.role }})</span>
                </li>
                <li class="nav-item"><a class="nav-link" href="{% url 'supervision:logout' %}">Deconnexion</a></li>
            </ul>
        </div>
    </div>
</nav>
{% endif %}

<main class="container-fluid py-4">
    {% block content %}{% endblock %}
</main>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
{% block scripts %}{% endblock %}
</body>
</html>
TPLEOF

# ----- login.html -----
cat > supervision/templates/supervision/login.html << 'TPLEOF'
{% extends "supervision/base.html" %}
{% block title %}Connexion - Supervision SODIGAZ{% endblock %}
{% block content %}
<div class="row justify-content-center">
    <div class="col-md-4">
        <div class="card shadow-sm mt-5">
            <div class="card-body p-4">
                <h4 class="card-title mb-4 text-center">Supervision logistique</h4>
                <form method="post">
                    {% csrf_token %}
                    {% if form.errors %}
                    <div class="alert alert-danger">
                        Identifiants invalides ou compte sans privilege superviseur.
                    </div>
                    {% endif %}
                    <div class="mb-3">
                        <label for="id_username" class="form-label">Nom d'utilisateur</label>
                        <input type="text" name="username" id="id_username" class="form-control" required autofocus>
                    </div>
                    <div class="mb-3">
                        <label for="id_password" class="form-label">Mot de passe</label>
                        <input type="password" name="password" id="id_password" class="form-control" required>
                    </div>
                    <button type="submit" class="btn btn-primary w-100">Se connecter</button>
                </form>
            </div>
        </div>
        <p class="text-muted small text-center mt-3">
            Compte demo : <code>aminata.s</code> / <code>demo1234</code>
        </p>
    </div>
</div>
{% endblock %}
TPLEOF

# ----- dashboard.html -----
cat > supervision/templates/supervision/dashboard.html << 'TPLEOF'
{% extends "supervision/base.html" %}
{% block title %}Tableau de bord{% endblock %}
{% block content %}
<h1 class="h3 mb-4">Tableau de bord - {{ today|date:"l j F Y" }}</h1>

<div class="row g-3 mb-4">
    <div class="col-md-3">
        <div class="card stat-card h-100">
            <div class="card-body">
                <div class="text-muted small">Programmes du jour</div>
                <div class="display-6">{{ nb_programmes }}</div>
                <div class="small">
                    {{ nb_programmes_en_cours }} en cours, {{ nb_programmes_clotures }} clotures
                </div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card stat-card success h-100">
            <div class="card-body">
                <div class="text-muted small">Operations realisees</div>
                <div class="display-6">{{ nb_operations }}</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card stat-card success h-100">
            <div class="card-body">
                <div class="text-muted small">Montant encaisse</div>
                <div class="display-6">{{ montant_encaisse|floatformat:0 }}</div>
                <div class="small">FCFA</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card stat-card danger h-100">
            <div class="card-body">
                <div class="text-muted small">Anomalies ouvertes</div>
                <div class="display-6">{{ nb_anomalies_ouvertes }}</div>
                {% if nb_anomalies_ouvertes > 0 %}
                <a href="{% url 'supervision:anomalies' %}" class="small">Voir &raquo;</a>
                {% endif %}
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
{% endblock %}

{% block scripts %}
<script>
const map = L.map('map').setView([12.3650, -1.5236], 13);  // Ouagadougou
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

fetch("{% url 'supervision:carte-data' %}")
    .then(r => r.json())
    .then(data => {
        data.plvs.forEach(plv => {
            L.marker([plv.latitude, plv.longitude], { icon: blueIcon })
                .bindPopup('<strong>' + plv.libelle + '</strong><br>' + plv.client)
                .addTo(map);
        });
        data.operations.forEach(op => {
            L.marker([op.latitude, op.longitude], { icon: greenIcon })
                .bindPopup(
                    '<strong>' + op.type + '</strong><br>' +
                    'Livreur ' + op.livreur + '<br>' +
                    'PLV : ' + op.plv
                )
                .addTo(map);
        });
    });

// Rafraichissement automatique toutes les 30 secondes
setTimeout(() => location.reload(), 30000);
</script>
{% endblock %}
TPLEOF

# ----- programmes_list.html -----
cat > supervision/templates/supervision/programmes_list.html << 'TPLEOF'
{% extends "supervision/base.html" %}
{% block title %}Programmes{% endblock %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-3">
    <h1 class="h3">Programmes du {{ date_filter|date:"j F Y" }}</h1>
    <form method="get" class="d-flex gap-2">
        <input type="date" name="date" value="{{ date_filter|date:'Y-m-d' }}" class="form-control">
        <button type="submit" class="btn btn-primary">Filtrer</button>
    </form>
</div>

{% if programmes %}
<table class="table table-hover bg-white">
    <thead>
        <tr>
            <th>Numero X3</th>
            <th>Livreur</th>
            <th>Type</th>
            <th>Vehicule</th>
            <th>Statut</th>
            <th>Progression</th>
            <th></th>
        </tr>
    </thead>
    <tbody>
        {% for p in programmes %}
        <tr>
            <td><code>{{ p.numero_x3 }}</code></td>
            <td>{{ p.utilisateur.code_livreur }} - {{ p.utilisateur.get_full_name }}</td>
            <td>{{ p.get_type_programme_display }}</td>
            <td>{{ p.vehicule.immatriculation|default:"-" }}</td>
            <td><span class="badge badge-statut-{{ p.statut }}">{{ p.get_statut_display }}</span></td>
            <td>
                {{ p.etapes_visitees }} / {{ p.total_etapes }} etapes
                {% if p.total_etapes > 0 %}
                <div class="progress" style="height: 6px;">
                    <div class="progress-bar" role="progressbar"
                         style="width: {% widthratio p.etapes_visitees p.total_etapes 100 %}%"></div>
                </div>
                {% endif %}
            </td>
            <td><a href="{% url 'supervision:programme-detail' p.id %}" class="btn btn-sm btn-outline-primary">Detail</a></td>
        </tr>
        {% endfor %}
    </tbody>
</table>
{% else %}
<div class="alert alert-info">Aucun programme pour cette date.</div>
{% endif %}
{% endblock %}
TPLEOF

# ----- programme_detail.html -----
cat > supervision/templates/supervision/programme_detail.html << 'TPLEOF'
{% extends "supervision/base.html" %}
{% block title %}Programme {{ programme.numero_x3 }}{% endblock %}
{% block content %}
<a href="{% url 'supervision:programmes' %}?date={{ programme.date_programme|date:'Y-m-d' }}" class="btn btn-sm btn-outline-secondary mb-3">&laquo; Retour aux programmes</a>

<h1 class="h3">{{ programme.numero_x3 }}</h1>
<div class="mb-3">
    <span class="badge bg-secondary">{{ programme.get_type_programme_display }}</span>
    <span class="badge badge-statut-{{ programme.statut }}">{{ programme.get_statut_display }}</span>
</div>

<dl class="row">
    <dt class="col-sm-3">Livreur</dt><dd class="col-sm-9">{{ programme.utilisateur.code_livreur }} - {{ programme.utilisateur.get_full_name }}</dd>
    <dt class="col-sm-3">Date</dt><dd class="col-sm-9">{{ programme.date_programme|date:"l j F Y" }}</dd>
    <dt class="col-sm-3">Vehicule</dt><dd class="col-sm-9">{{ programme.vehicule.immatriculation|default:"-" }}</dd>
    <dt class="col-sm-3">Demarre a</dt><dd class="col-sm-9">{{ programme.heure_debut|default:"-" }}</dd>
    <dt class="col-sm-3">Cloture a</dt><dd class="col-sm-9">{{ programme.heure_fin|default:"-" }}</dd>
</dl>

<h2 class="h5 mt-4">Reconciliation prevu / realise par etape</h2>
{% for r in reconciliation %}
<div class="card mb-3">
    <div class="card-header d-flex justify-content-between">
        <div>
            <strong>Etape {{ r.etape.ordre_prevu }}</strong> &mdash;
            {{ r.etape.plv.libelle }}
            <span class="text-muted">({{ r.etape.plv.client.raison_sociale }})</span>
        </div>
        <span class="badge badge-statut-{{ r.etape.statut_visite }}">{{ r.etape.get_statut_visite_display }}</span>
    </div>
    <div class="card-body">
        {% if r.lignes %}
        <table class="table table-sm mb-0">
            <thead><tr><th>Produit</th><th class="text-end">Prevu</th><th class="text-end">Realise</th><th class="text-end">Ecart</th></tr></thead>
            <tbody>
            {% for l in r.lignes %}
                <tr>
                    <td>{{ l.produit.libelle }}</td>
                    <td class="text-end">{{ l.prevu }}</td>
                    <td class="text-end">{{ l.realise }}</td>
                    <td class="text-end {% if l.ecart > 0 %}ecart-positif{% elif l.ecart < 0 %}ecart-negatif{% else %}ecart-nul{% endif %}">
                        {% if l.ecart > 0 %}+{% endif %}{{ l.ecart }}
                    </td>
                </tr>
            {% endfor %}
            </tbody>
        </table>
        {% else %}
        <p class="text-muted mb-0">Aucune ligne prevue ni realisee.</p>
        {% endif %}
    </div>
</div>
{% empty %}
<div class="alert alert-info">Pas d'etapes dans ce programme.</div>
{% endfor %}
{% endblock %}
TPLEOF

# ----- operations_list.html -----
cat > supervision/templates/supervision/operations_list.html << 'TPLEOF'
{% extends "supervision/base.html" %}
{% block title %}Operations{% endblock %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-3">
    <h1 class="h3">Operations du {{ date_filter|date:"j F Y" }}</h1>
    <form method="get" class="d-flex gap-2">
        <input type="date" name="date" value="{{ date_filter|date:'Y-m-d' }}" class="form-control">
        <select name="livreur" class="form-select">
            <option value="">Tous les livreurs</option>
            {% for liv in livreurs %}
            <option value="{{ liv.code_livreur }}" {% if liv.code_livreur == livreur_code %}selected{% endif %}>
                {{ liv.code_livreur }} - {{ liv.get_full_name }}
            </option>
            {% endfor %}
        </select>
        <button type="submit" class="btn btn-primary">Filtrer</button>
    </form>
</div>

{% if operations %}
<table class="table table-hover bg-white">
    <thead>
        <tr>
            <th>Heure</th>
            <th>Livreur</th>
            <th>Type</th>
            <th>Client / PLV</th>
            <th class="text-end">Montant</th>
            <th>Paiement</th>
            <th>Signataire</th>
        </tr>
    </thead>
    <tbody>
        {% for op in operations %}
        <tr>
            <td>{{ op.date_heure|date:"H:i" }}</td>
            <td>{{ op.etape.programme.utilisateur.code_livreur }}</td>
            <td>
                {{ op.get_type_operation_display }}
                {% if op.sous_type %}<small class="text-muted">({{ op.sous_type }})</small>{% endif %}
            </td>
            <td>{{ op.etape.plv.client.raison_sociale }} <br><small class="text-muted">{{ op.etape.plv.libelle }}</small></td>
            <td class="text-end">{{ op.montant_total|floatformat:0 }}</td>
            <td>{{ op.get_mode_paiement_display|default:"-" }}</td>
            <td>{{ op.nom_signataire_client|default:"-" }}</td>
        </tr>
        {% endfor %}
    </tbody>
</table>
{% else %}
<div class="alert alert-info">Aucune operation pour cette date / livreur.</div>
{% endif %}
{% endblock %}
TPLEOF

# ----- anomalies_list.html -----
cat > supervision/templates/supervision/anomalies_list.html << 'TPLEOF'
{% extends "supervision/base.html" %}
{% block title %}Anomalies{% endblock %}
{% block content %}
<div class="d-flex justify-content-between align-items-center mb-3">
    <h1 class="h3">Anomalies</h1>
    <form method="get" class="d-flex gap-2">
        <select name="statut" class="form-select">
            <option value="OUVERTE" {% if statut_filter == "OUVERTE" %}selected{% endif %}>Ouvertes uniquement</option>
            <option value="EN_TRAITEMENT" {% if statut_filter == "EN_TRAITEMENT" %}selected{% endif %}>En traitement</option>
            <option value="RESOLUE" {% if statut_filter == "RESOLUE" %}selected{% endif %}>Resolues</option>
            <option value="TOUS" {% if statut_filter == "TOUS" %}selected{% endif %}>Toutes</option>
        </select>
        <button type="submit" class="btn btn-primary">Filtrer</button>
    </form>
</div>

{% if anomalies %}
<table class="table table-hover bg-white">
    <thead>
        <tr>
            <th>Date</th>
            <th>Programme / Livreur</th>
            <th>Type</th>
            <th>Gravite</th>
            <th>Description</th>
            <th>PLV</th>
            <th>Statut</th>
        </tr>
    </thead>
    <tbody>
        {% for a in anomalies %}
        <tr>
            <td>{{ a.date_heure|date:"d/m H:i" }}</td>
            <td>
                {{ a.programme.numero_x3 }}<br>
                <small class="text-muted">{{ a.programme.utilisateur.code_livreur }}</small>
            </td>
            <td>{{ a.type_anomalie }}</td>
            <td>{{ a.get_gravite_display }}</td>
            <td>{{ a.description|truncatewords:15 }}</td>
            <td>{{ a.plv.libelle|default:"-" }}</td>
            <td><span class="badge badge-statut-{{ a.statut }}">{{ a.get_statut_display }}</span></td>
        </tr>
        {% endfor %}
    </tbody>
</table>
{% else %}
<div class="alert alert-info">Aucune anomalie pour ce filtre.</div>
{% endif %}
{% endblock %}
TPLEOF

echo "OK : templates crees"

# =============================================================================
echo ""
echo "=== Etape 3 : configuration settings + urls ==="

python3 << 'PYEOF'
from pathlib import Path
import re

# settings.py - ajouter supervision aux INSTALLED_APPS + LOGIN_URL
settings_path = Path("config/settings.py")
content = settings_path.read_text()

if '"supervision"' not in content:
    content = re.sub(
        r'("sync_api",\s*\n)(\])',
        r'\1    "supervision",\n\2',
        content,
    )
    print("  + supervision ajoute aux INSTALLED_APPS")

if "LOGIN_URL" not in content:
    content += '''

# Redirections d'authentification pour la supervision web
LOGIN_URL = "/supervision/login/"
LOGIN_REDIRECT_URL = "/supervision/"
LOGOUT_REDIRECT_URL = "/supervision/login/"
'''
    print("  + LOGIN_URL et redirections ajoutes")

settings_path.write_text(content)

# urls.py - ajouter la route /supervision/
urls_path = Path("config/urls.py")
content = urls_path.read_text()

if "supervision" not in content:
    new_content = '''from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("auth_api.urls")),
    path("api/mock-x3/", include("mock_x3.urls")),
    path("api/sync/", include("sync_api.urls")),
    path("supervision/", include("supervision.urls")),
]
'''
    urls_path.write_text(new_content)
    print("  + route /supervision/ ajoutee")
else:
    print("  = route /supervision/ deja presente")
PYEOF

# =============================================================================
echo ""
echo "=============================================="
echo "INSTALLATION SUPERVISION TERMINEE."
echo "=============================================="
echo ""
echo "Demarre le serveur :"
echo "  python manage.py runserver"
echo ""
echo "Puis va sur :"
echo "  http://localhost:8000/supervision/"
echo ""
echo "Connexion :"
echo "  - username : aminata.s"
echo "  - mot de passe : demo1234"
echo ""
echo "Astuce : pour avoir des donnees a afficher, lance d'abord"
echo "le scenario de test sync (qui creera une operation), ou cree"
echo "manuellement quelques operations via l'admin."
echo ""
