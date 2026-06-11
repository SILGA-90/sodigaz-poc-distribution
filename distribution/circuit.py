"""
Calcul de l'ordre de visite suggéré d'une tournée.

Ce module implémente l'heuristique du PLUS PROCHE VOISIN (nearest
neighbor) pour ordonner les étapes d'un programme. Le résultat est
écrit dans Etape.ordre_optimise et présenté au livreur comme
recommandation de circuit.

L'optimum exact (voyageur de commerce / VRP) est
NP-difficile. L'heuristique du plus proche voisin est O(n²), négligeable
pour quelques étapes (5-15 PLVs par tournée), et produit un ordre
généralement bien meilleur qu'un ordre arbitraire. La précision d'un
algorithme exact n'est pas justifiée pour ce POC : le livreur reste libre
de dévier de l'ordre recommandé (contraintes terrain : trafic, PLV fermé,
priorité client).

L'ordre optimisé est affiché au livreur mais
non bloquant. Le terrain impose souvent des déviations que l'algorithme
ne peut pas anticiper. La conformité au circuit est analysée a posteriori
dans la timeline du programme_detail (supervision).

Les coordonnées sont en WGS84 (SRID 4326).
La distance angulaire retournée par .distance() Django serait en degrés,
incorrecte pour comparer des distances. La formule de Haversine donne une
distance métrique suffisamment précise à l'échelle d'une ville comme
Ouagadougou (<1 % d'erreur jusqu'à ~500 km).
"""
import math

from django.conf import settings
from django.contrib.gis.geos import Point


class CircuitOptimizer:
    """
    Calcule et applique l'ordre de visite optimal des étapes d'un programme,
    en utilisant l'heuristique du plus proche voisin depuis le dépôt SODIGAZ.

    Encapsule le point de départ (dépôt) comme état de l'instance, ce qui
    permet de configurer le dépôt une seule fois et de l'utiliser pour
    plusieurs appels à appliquer() sans relire les settings à chaque fois.

    Usage :
        optimizer = CircuitOptimizer()
        optimizer.appliquer(programme)
    """

    def __init__(self):
        depot = settings.DEPOT_SODIGAZ
        self._depot = Point(depot["longitude"], depot["latitude"], srid=4326)

    # ------------------------------------------------------------------
    # Interface publique
    # ------------------------------------------------------------------

    def appliquer(self, programme):
        """
        Calcule et persiste l'ordre optimisé sur toutes les étapes actives
        du programme.

        On ne met à jour que le champ ordre_optimise pour ne pas écraser
        last_modified ou d'autres champs modifiés entre-temps. Le trigger
        PostgreSQL met à jour last_modified automatiquement, ce qui signalera
        le changement au prochain pull mobile.

        Retourne la liste des tuples (etape, ordre_optimise, distance_m).
        """
        etapes = list(
            programme.etapes.filter(is_deleted=False).select_related("plv")
        )
        if not etapes:
            return []

        classement = self._calculer_ordre(etapes)
        for etape, ordre, _distance in classement:
            etape.ordre_optimise = ordre
            etape.save(update_fields=["ordre_optimise"])
        return classement

    # ------------------------------------------------------------------
    # Algorithme
    # ------------------------------------------------------------------

    def _calculer_ordre(self, etapes):
        """
        Nearest neighbor depuis self._depot.
        Retourne une liste de tuples (etape, ordre_1based, distance_metres).
        Les étapes sans localisation sont placées à la fin, dans leur ordre
        d'arrivée (cas défensif : tous les PLVs ont normalement un PointField).
        """
        avec_geo = [e for e in etapes if e.plv and e.plv.localisation is not None]
        sans_geo = [e for e in etapes if not (e.plv and e.plv.localisation is not None)]

        resultat = []
        point_courant = self._depot
        restantes = list(avec_geo)
        ordre = 1

        while restantes:
            plus_proche, meilleure_distance = None, None
            for etape in restantes:
                d = self._distance_metres(point_courant, etape.plv.localisation)
                if meilleure_distance is None or d < meilleure_distance:
                    meilleure_distance, plus_proche = d, etape

            resultat.append((plus_proche, ordre, meilleure_distance))
            point_courant = plus_proche.plv.localisation
            restantes.remove(plus_proche)
            ordre += 1

        for etape in sans_geo:
            resultat.append((etape, ordre, None))
            ordre += 1

        return resultat

    @staticmethod
    def _distance_metres(point_a, point_b):
        """
        Distance géodésique en mètres entre deux points WGS84 (Haversine).

        On n'utilise pas .distance() Django car il retourne des degrés sur
        des géométries SRID 4326, pas des mètres. La formule de Haversine
        évite une requête SQL pour chaque comparaison dans la boucle de
        l'algorithme. L'erreur est inférieure à 0,5 % à cette échelle.
        """
        lon1, lat1 = point_a.x, point_a.y
        lon2, lat2 = point_b.x, point_b.y

        R = 6371000.0
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi    = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)

        a = (math.sin(dphi / 2) ** 2
             + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ------------------------------------------------------------------
# Compatibilité avec l'interface fonctionnelle existante
# Les commandes de gestion (generer_programmes_du_jour, calculer_circuits)
# importent appliquer_ordre_optimise par son nom.
# ------------------------------------------------------------------

def appliquer_ordre_optimise(programme):
    """
    Conserve l'interface fonctionnelle pour les appelants existants.
    Délègue à CircuitOptimizer().appliquer(programme).
    """
    return CircuitOptimizer().appliquer(programme)
