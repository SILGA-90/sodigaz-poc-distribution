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
