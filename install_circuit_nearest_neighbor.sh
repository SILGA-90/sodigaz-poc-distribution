#!/bin/bash
# =============================================================================
# Calcul du circuit suggere par heuristique du plus proche voisin
# (nearest neighbor), depuis un point de depot fixe et configurable.
#
# Ce script :
#   1. Ajoute le point de depot SODIGAZ dans config/settings.py (configurable)
#   2. Cree une fonction utilitaire de calcul nearest neighbor (PostGIS)
#   3. Branche ce calcul dans la commande generer_programmes_du_jour
#      (remplissage du champ Etape.ordre_optimise apres creation des etapes)
#   4. Ajoute une commande dediee 'calculer_circuits' pour recalculer
#      l'ordre optimise sur des programmes existants (utile pour la demo)
#
# Usage : depuis ~/sodigaz_poc avec le venv active, bash install_circuit_nearest_neighbor.sh
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
echo "=== Etape 1 : ajout du point de depot dans config/settings.py ==="

python3 << 'PYEOF'
from pathlib import Path

settings_path = Path("config/settings.py")
content = settings_path.read_text()

if "DEPOT_SODIGAZ" not in content:
    content += '''

# =============================================================================
# Point de depart des tournees : le depot SODIGAZ.
# Sert de point d'origine a l'heuristique du plus proche voisin qui calcule
# l'ordre de visite suggere (champ Etape.ordre_optimise).
#
# ATTENTION : ce sont des coordonnees PLAUSIBLES a Ouagadougou, PAS les vraies
# coordonnees du depot SODIGAZ. A remplacer par les coordonnees reelles quand
# elles seront connues. Format : (longitude, latitude).
# (zone industrielle de Kossodo, nord-est de Ouaga, a titre indicatif)
# =============================================================================
DEPOT_SODIGAZ = {
    "nom": "Depot SODIGAZ (coordonnees provisoires)",
    "longitude": -1.4900,
    "latitude": 12.4100,
}
'''
    settings_path.write_text(content)
    print("  + DEPOT_SODIGAZ ajoute a settings.py")
else:
    print("  = DEPOT_SODIGAZ deja present")
PYEOF

# =============================================================================
echo ""
echo "=== Etape 2 : creation du module de calcul de circuit ==="

# On place le module dans distribution/ pour qu'il soit reutilisable
# (par la commande de generation ET par la commande de recalcul).

cat > distribution/circuit.py << 'PYEOF'
"""
Calcul de l'ordre de visite suggere d'une tournee.

Heuristique retenue : le PLUS PROCHE VOISIN (nearest neighbor).

Principe :
  - On part d'un point de depart (le depot SODIGAZ).
  - On va a l'etape la plus proche du point courant.
  - Depuis cette etape, on va a la plus proche des etapes restantes.
  - Et ainsi de suite jusqu'a epuisement.

Cette heuristique est simple, rapide (O(n^2), negligeable pour quelques
etapes), et produit un ordre de visite coherent, bien meilleur qu'un ordre
arbitraire. Elle ne garantit PAS l'optimalite : c'est un algorithme glouton,
le probleme exact (voyageur de commerce / VRP) reste une perspective.

Le resultat est ecrit dans le champ Etape.ordre_optimise. C'est une
RECOMMANDATION : le livreur reste libre de visiter les etapes dans l'ordre
qu'il souhaite (contrainte terrain).

Les distances sont calculees par PostGIS sur le type geography (distances
geodesiques en metres), via la methode .distance() de GeoDjango sur des
objets Point en SRID 4326.
"""
from django.conf import settings
from django.contrib.gis.geos import Point


def _point_depot():
    """Retourne le Point GeoDjango du depot, depuis settings.DEPOT_SODIGAZ."""
    depot = settings.DEPOT_SODIGAZ
    return Point(depot["longitude"], depot["latitude"], srid=4326)


def calculer_ordre_nearest_neighbor(etapes):
    """
    Calcule l'ordre de visite par plus proche voisin.

    Parametre :
        etapes : iterable d'objets Etape, chacun ayant etape.plv.localisation
                 (un PointField non nul).

    Retour :
        liste de tuples (etape, ordre_optimise, distance_depuis_precedent_m)
        dans l'ordre de visite calcule. ordre_optimise commence a 1.
        distance_depuis_precedent_m est la distance (metres) entre le point
        courant et l'etape choisie (depuis le depot pour la premiere etape).

    Note : les etapes sans localisation sont placees a la fin, dans leur
    ordre d'arrivee, avec une distance None (cas defensif ; en pratique
    tous les PLV ont une localisation).
    """
    # On separe les etapes geolocalisees des autres (cas defensif)
    avec_geo = [e for e in etapes if e.plv and e.plv.localisation is not None]
    sans_geo = [e for e in etapes if not (e.plv and e.plv.localisation is not None)]

    resultat = []
    point_courant = _point_depot()
    restantes = list(avec_geo)
    ordre = 1

    while restantes:
        # Trouver l'etape la plus proche du point courant
        plus_proche = None
        meilleure_distance = None
        for etape in restantes:
            # distance() sur des Point SRID 4326 retourne des degres ;
            # pour une distance metrique fiable, on transforme en geography.
            # GeoDjango : on peut utiliser .distance() apres transform, mais
            # ici on calcule simplement via la methode distance des geometries
            # transformees en geography pour rester en metres.
            d = _distance_metres(point_courant, etape.plv.localisation)
            if meilleure_distance is None or d < meilleure_distance:
                meilleure_distance = d
                plus_proche = etape

        resultat.append((plus_proche, ordre, meilleure_distance))
        point_courant = plus_proche.plv.localisation
        restantes.remove(plus_proche)
        ordre += 1

    # Etapes sans localisation : a la fin
    for etape in sans_geo:
        resultat.append((etape, ordre, None))
        ordre += 1

    return resultat


def _distance_metres(point_a, point_b):
    """
    Distance geodesique en metres entre deux Point SRID 4326.

    On passe par le type geography de PostGIS via une petite requete, ce qui
    donne une distance metrique correcte (vs degres si on restait en geometry).
    Pour rester simple et sans dependance, on utilise la formule de Haversine,
    suffisamment precise a l'echelle d'une ville.
    """
    import math

    lon1, lat1 = point_a.x, point_a.y
    lon2, lat2 = point_b.x, point_b.y

    R = 6371000.0  # rayon terrestre moyen en metres
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def appliquer_ordre_optimise(programme):
    """
    Calcule et enregistre l'ordre optimise sur toutes les etapes d'un programme.

    Retourne la liste des tuples (etape, ordre_optimise, distance_m) pour
    information / affichage eventuel.
    """
    etapes = list(
        programme.etapes.filter(is_deleted=False).select_related("plv")
    )
    if not etapes:
        return []

    classement = calculer_ordre_nearest_neighbor(etapes)
    for etape, ordre, _distance in classement:
        etape.ordre_optimise = ordre
        etape.save(update_fields=["ordre_optimise"])
    return classement
PYEOF

echo "  + distribution/circuit.py cree"

# =============================================================================
echo ""
echo "=== Etape 3 : branchement dans generer_programmes_du_jour ==="

python3 << 'PYEOF'
from pathlib import Path

cmd_path = Path("mock_x3/management/commands/generer_programmes_du_jour.py")
content = cmd_path.read_text()

ok = True

# 3a. Ajouter l'import du module circuit (apres les imports distribution)
if "from distribution.circuit import" not in content:
    anchor = "from distribution.models import ("
    if anchor in content:
        content = content.replace(
            anchor,
            "from distribution.circuit import appliquer_ordre_optimise\n" + anchor,
            1,
        )
        print("  OK : import appliquer_ordre_optimise ajoute")
    else:
        print("  !! ECHEC : ancre d'import 'from distribution.models import (' introuvable")
        ok = False
else:
    print("  = import appliquer_ordre_optimise deja present")

# 3b. Appeler appliquer_ordre_optimise(programme) juste apres la boucle de
# creation des etapes, avant l'incrementation du compteur.
# On cible la ligne 'compteur += 1' qui suit la creation des etapes.
if "appliquer_ordre_optimise(programme)" not in content:
    anchor = "                compteur += 1\n"
    if anchor in content:
        insertion = (
            "                # Calcul de l'ordre de visite suggere (plus proche voisin)\n"
            "                appliquer_ordre_optimise(programme)\n\n"
        )
        content = content.replace(anchor, insertion + anchor, 1)
        print("  OK : appel appliquer_ordre_optimise(programme) insere")
    else:
        print("  !! ECHEC : ancre 'compteur += 1' introuvable")
        ok = False
else:
    print("  = appel appliquer_ordre_optimise deja present")

if ok:
    cmd_path.write_text(content)
    print("  OK : generer_programmes_du_jour mise a jour")
else:
    print("  !! ECHEC : fichier NON modifie, corrige les ancres avant de relancer")
PYEOF

# =============================================================================
echo ""
echo "=== Etape 4 : commande dediee 'calculer_circuits' ==="

cat > mock_x3/management/commands/calculer_circuits.py << 'PYEOF'
"""
Recalcule l'ordre de visite suggere (plus proche voisin) pour les programmes
existants. Utile pour appliquer le circuit a des programmes deja generes
(avant l'ajout de cette fonctionnalite), ou pour rejouer le calcul apres
avoir corrige les coordonnees du depot.

Usage :
    python manage.py calculer_circuits
    python manage.py calculer_circuits --date 2026-06-02
    python manage.py calculer_circuits --livreur LIV001
    python manage.py calculer_circuits --verbose
"""
from datetime import date as date_cls
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from distribution.circuit import appliquer_ordre_optimise
from distribution.models import Programme


class Command(BaseCommand):
    help = "Recalcule l'ordre de visite suggere (plus proche voisin)."

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str,
            help="Date des programmes (YYYY-MM-DD). Par defaut : aujourd'hui.")
        parser.add_argument("--livreur", type=str,
            help="Code livreur specifique. Par defaut : tous.")
        parser.add_argument("--verbose", action="store_true",
            help="Affiche le detail du circuit calcule (ordre + distances).")

    def handle(self, *args, **options):
        if options["date"]:
            try:
                date_prog = datetime.strptime(options["date"], "%Y-%m-%d").date()
            except ValueError as e:
                raise CommandError(f"Format de date invalide : {e}")
        else:
            date_prog = date_cls.today()

        qs = Programme.objects.filter(date_programme=date_prog, is_deleted=False)
        if options["livreur"]:
            qs = qs.filter(utilisateur__code_livreur=options["livreur"])

        programmes = list(qs.select_related("utilisateur"))
        if not programmes:
            self.stdout.write(self.style.WARNING(
                f"Aucun programme pour le {date_prog}."
            ))
            return

        for prog in programmes:
            classement = appliquer_ordre_optimise(prog)
            self.stdout.write(
                f"  {prog.numero_x3} : {len(classement)} etape(s) ordonnee(s)"
            )
            if options["verbose"]:
                for etape, ordre, distance in classement:
                    d = f"{distance:.0f} m" if distance is not None else "n/a"
                    self.stdout.write(
                        f"      {ordre}. {etape.plv.libelle} "
                        f"(depuis precedent : {d})"
                    )

        self.stdout.write(self.style.SUCCESS(
            f"\nCircuits calcules pour {len(programmes)} programme(s) du {date_prog}."
        ))
PYEOF

echo "  + commande calculer_circuits creee"

# =============================================================================
echo ""
echo "=== Etape 5 : exposer ordre_optimise + distance dans le pull mobile ==="
echo "    (le serializer Etape inclut deja ordre_optimise ; on verifie)"

if grep -q "ordre_optimise" sync_api/serializers.py; then
    echo "  = ordre_optimise deja serialise dans le pull (rien a faire)"
else
    echo "  !! ATTENTION : ordre_optimise absent du EtapeSyncSerializer."
    echo "     Verifie sync_api/serializers.py manuellement."
fi

# =============================================================================
echo ""
echo "=============================================="
echo "CIRCUIT NEAREST NEIGHBOR INSTALLE."
echo "=============================================="
echo ""
echo "ETAPES DE TEST :"
echo ""
echo "1. Redemarre le serveur si besoin, puis recalcule les circuits"
echo "   sur les programmes du jour deja existants :"
echo ""
echo "     python manage.py calculer_circuits --verbose"
echo ""
echo "   Tu dois voir, pour chaque programme, les etapes numerotees 1,2,3..."
echo "   dans l'ordre du plus proche voisin, avec les distances."
echo ""
echo "2. Verifie dans l'admin (Etapes) que le champ ordre_optimise est rempli."
echo ""
echo "3. Pour les FUTURS programmes, l'ordre sera calcule automatiquement"
echo "   par 'generer_programmes_du_jour' (plus besoin de calculer_circuits)."
echo ""
echo "IMPORTANT : les coordonnees du depot dans settings.py (DEPOT_SODIGAZ)"
echo "sont PROVISOIRES. Remplace-les par les vraies coordonnees du depot"
echo "SODIGAZ des que tu les as, puis relance 'calculer_circuits'."
echo ""
