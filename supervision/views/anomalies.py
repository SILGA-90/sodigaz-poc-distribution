"""
Vues des anomalies terrain (liste, détail, changement de statut / gravité).

Ce module expose quatre vues pour la gestion des anomalies :
  - anomalies_list()           : liste filtrée des anomalies (statut, gravité,
                                  livreur, programme, date)
  - anomalie_detail()          : détail d'une anomalie avec ses photos
  - changer_statut_anomalie()  : action superviseur : mise à jour du statut
  - changer_gravite_anomalie() : action superviseur : reclassification de la gravité

Une anomalie peut ne pas être liée à
une opération spécifique (ex. accident de route, bris de matériel en
dehors d'une étape). Elle est rattachée au programme global. Le superviseur
doit pouvoir les traiter indépendamment.

On calcule l'ancienneté en
Python après le requêtage plutôt qu'en SQL (via EXTRACT ou timedelta)
pour éviter une dépendance sur le timezone serveur dans la requête ORM.
timezone.now() est le bon moment de référence.

Les actions de changement de statut/gravité
peuvent être déclenchées depuis la liste ou le détail. Rediriger vers
la page précédente (Referer) offre une meilleure UX que de rediriger
toujours vers la liste.
"""
from datetime import datetime

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone

from accounts.models import Role, Utilisateur
from distribution.models import Anomalie, GraviteAnomalie, StatutAnomalie

from ..decorators import superviseur_required


@superviseur_required
def anomalies_list(request):
    """
    Affiche la liste des anomalies avec filtres cumulatifs.
    Compteurs par gravité et détection des anomalies urgentes (≥ 1 jour).

    Chaque filtre est appliqué conditionnellement.
         Un superviseur peut combiner statut=OUVERTE + gravite=ELEVEE pour voir
         uniquement les alertes critiques non traitées.

    Une anomalie ouverte ou en traitement depuis plus d'un
         jour mérite une attention particulière. Ce compteur met en évidence
         les anomalies qui "traînent" sans être prises en charge.
    """
    statut_filter  = request.GET.get("statut",    "OUVERTE")
    gravite_filter = request.GET.get("gravite",   "").strip()
    livreur_filter = request.GET.get("livreur",   "").strip()
    prog_filter    = request.GET.get("programme", "").strip()
    date_str       = request.GET.get("date",      "").strip()

    anomalies_qs = (
        Anomalie.objects
        .filter(is_deleted=False, programme__is_deleted=False)
        .select_related("programme__utilisateur", "plv__client")
        .annotate(nb_photos=Count("photos", filter=Q(photos__is_deleted=False)))
        .order_by("-date_heure")
    )

    if statut_filter and statut_filter != "TOUS":
        anomalies_qs = anomalies_qs.filter(statut=statut_filter)
    if gravite_filter in GraviteAnomalie.values:
        anomalies_qs = anomalies_qs.filter(gravite=gravite_filter)
    if livreur_filter:
        anomalies_qs = anomalies_qs.filter(
            programme__utilisateur__code_livreur=livreur_filter
        )
    if prog_filter:
        anomalies_qs = anomalies_qs.filter(
            programme__numero_x3__icontains=prog_filter
        )
    if date_str:
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d").date()
            anomalies_qs = anomalies_qs.filter(programme__date_programme=d)
        except ValueError:
            pass

    livreurs = Utilisateur.objects.filter(
        role=Role.LIVREUR, is_active=True
    ).order_by("code_livreur")

    # Calcul de l'ancienneté en Python après le requêtage
    now       = timezone.now()
    anomalies = list(anomalies_qs)
    for a in anomalies:
        a.anciennete_jours = (now - a.date_heure).days

    nb_total    = len(anomalies)
    nb_elevee   = sum(1 for a in anomalies if a.gravite == GraviteAnomalie.ELEVEE)
    nb_moyenne  = sum(1 for a in anomalies if a.gravite == GraviteAnomalie.MOYENNE)
    nb_faible   = sum(1 for a in anomalies if a.gravite == GraviteAnomalie.FAIBLE)
    nb_urgentes = sum(
        1 for a in anomalies
        if a.statut in (StatutAnomalie.OUVERTE, StatutAnomalie.EN_TRAITEMENT)
        and a.anciennete_jours >= 1
    )

    return render(request, "supervision/anomalies_list.html", {
        "anomalies":      anomalies,
        "statut_filter":  statut_filter,
        "gravite_filter": gravite_filter,
        "livreur_filter": livreur_filter,
        "prog_filter":    prog_filter,
        "date_filter":    date_str,
        "livreurs":       livreurs,
        "nb_total":       nb_total,
        "nb_elevee":      nb_elevee,
        "nb_moyenne":     nb_moyenne,
        "nb_faible":      nb_faible,
        "nb_urgentes":    nb_urgentes,
    })


@superviseur_required
def anomalie_detail(request, anomalie_id):
    """
    Affiche le détail d'une anomalie avec ses photos associées.
    Une anomalie peut avoir plusieurs photos :
         le prefetch évite une requête par photo lors de l'affichage.
    """
    anomalie = get_object_or_404(
        Anomalie.objects
        .select_related("programme__utilisateur", "plv__client")
        .prefetch_related("photos"),
        id=anomalie_id,
        is_deleted=False,
    )
    return render(request, "supervision/anomalie_detail.html", {"anomalie": anomalie})


@superviseur_required
def changer_statut_anomalie(request, anomalie_id):
    """
    Met à jour le statut d'une anomalie (action superviseur uniquement).
    WHY (.update() sur queryset) : .update() fait un UPDATE SQL direct sans
         charger l'objet en mémoire : plus efficace qu'un get() + .save().
         Le trigger PostgreSQL mettra à jour last_modified automatiquement.
    """
    if request.method == "POST":
        nouveau_statut = request.POST.get("statut", "")
        if nouveau_statut in StatutAnomalie.values:
            Anomalie.objects.filter(id=anomalie_id, is_deleted=False).update(
                statut=nouveau_statut
            )
    referer = request.META.get("HTTP_REFERER")
    return redirect(referer if referer else "supervision:anomalies")


@superviseur_required
def changer_gravite_anomalie(request, anomalie_id):
    """
    Reclassifie la gravité d'une anomalie (action superviseur uniquement).
    Le livreur saisit la gravité perçue sur le terrain. Le superviseur,
    avec plus de contexte, peut ajuster cette classification (ex. une
    anomalie signalée MOYENNE peut être ELEVEE après vérification).
    """
    if request.method == "POST":
        nouvelle_gravite = request.POST.get("gravite", "")
        if nouvelle_gravite in GraviteAnomalie.values:
            Anomalie.objects.filter(id=anomalie_id, is_deleted=False).update(
                gravite=nouvelle_gravite
            )
    referer = request.META.get("HTTP_REFERER")
    return redirect(referer if referer else "supervision:anomalies")
