"""
Commande Django simulant l'export quotidien de Sage X3.

Cette commande génère les programmes du jour pour les livreurs actifs,
en simulant ce que ferait un export planifié depuis Sage X3 chaque matin.
Elle crée les programmes, étapes, lignes prévues et calcule le circuit.

Dans le POC, Sage X3 n'est pas connecté. Cette commande
produit des données réalistes à partir du référentiel (PLVs, clients,
articles, livreurs) pour permettre les démonstrations end-to-end.

Le soft-delete des anciens programmes propagé
via is_deleted permet au mobile de recevoir les suppressions dans la liste
"deleted" du prochain pull : les données locales sont cohérentes avec le
serveur. Un DELETE physique ferait disparaître les UUIDs sans que le mobile
le sache.

Un même client ne doit pas apparaître
dans les programmes de deux livreurs différents le même jour : cela
créerait des conflits de stock. On partitionne les groupes de PLVs par
client_id et on les distribue aux livreurs en round-robin.

Les numéros de programme X3 doivent être uniques.
On inclut HHMMSS dans le numéro et on incrémente d'1 seconde si une
collision existe (_numero_libre).

Scenários de type programme :
  - COLLECTE seul   : 37 % des cas
  - RESTITUTION seul: 37 % des cas
  - Les deux        : 26 % des cas
"""
import random
import uuid
from collections import defaultdict
from datetime import date as date_cls
from datetime import datetime, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import Role, Utilisateur
from distribution.circuit import appliquer_ordre_optimise
from distribution.models import (
    Anomalie,
    Etape,
    GraviteAnomalie,
    LigneProgramme,
    Plv,
    Article,
    Programme,
    StatutAnomalie,
    StatutProgramme,
    TypeProgramme,
    Vehicule,
)

_TYPES_ANOMALIE = [
    "Client absent",
    "Problème accès dépôt",
    "Bouteille endommagée",
    "Quantité insuffisante en stock camion",
    "Refus de réception client",
]

# Scénarios de type programme et leurs poids
_SCENARIOS = [
    [TypeProgramme.COLLECTE],
    [TypeProgramme.RESTITUTION],
    [TypeProgramme.COLLECTE, TypeProgramme.RESTITUTION],
]
_POIDS = [3, 3, 2]  # 37 % COL, 37 % RES, 26 % les deux


def _numero_libre(prefix: str, candidat: datetime) -> str:
    """
    Trouve le premier numéro X3 libre pour ce préfixe en incrémentant
    la partie HHMMSS d'une seconde à la fois.
    Garantit l'unicité des numéros même si deux programmes sont générés
    dans la même seconde (cas des programmes multiples en --type LES2).
    """
    while Programme.objects.filter(
        numero_x3=prefix + candidat.strftime("%H%M%S"),
        is_deleted=False,
    ).exists():
        candidat += timedelta(seconds=1)
    return prefix + candidat.strftime("%H%M%S")


class Command(BaseCommand):
    help = "Génère les programmes du jour (simulation Sage X3)."

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str,
            help="Date du programme (YYYY-MM-DD). Par défaut : aujourd'hui.")
        parser.add_argument("--livreur", type=str,
            help="Code livreur spécifique. Par défaut : tous.")
        parser.add_argument("--type", type=str, choices=["COL", "RES", "LES2"],
            help="Forcer le type pour tous les livreurs : COL / RES / LES2.")
        parser.add_argument("--reset", action="store_true",
            help="Soft-delete les programmes existants pour la date avant régénération.")

    def handle(self, *args, **options):
        if options["date"]:
            try:
                date_prog = datetime.strptime(options["date"], "%Y-%m-%d").date()
            except ValueError as e:
                raise CommandError(f"Format de date invalide : {e}")
        else:
            date_prog = date_cls.today()

        livreurs_qs = Utilisateur.objects.filter(role=Role.LIVREUR, is_active=True)
        if options["livreur"]:
            livreurs_qs = livreurs_qs.filter(code_livreur=options["livreur"])
        livreurs = list(livreurs_qs)
        if not livreurs:
            raise CommandError("Aucun livreur actif trouvé.")

        plvs = list(Plv.objects.filter(statut="ACTIF").select_related("client"))
        if len(plvs) < 3:
            raise CommandError(
                f"Pas assez de PLV actifs ({len(plvs)}). Lance d'abord 'seed_demo'."
            )
        vehicules     = list(Vehicule.objects.filter(actif=True))
        articles_gaz  = list(Article.objects.filter(actif=True, code_x3__startswith='G'))
        if not articles_gaz:
            raise CommandError("Articles G* (gaz emballé) manquants. Lance d'abord 'seed_demo'.")

        if options["reset"]:
            # Soft-delete en cascade : anomalies d'abord, puis programmes.
            # Le trigger PostgreSQL met à jour last_modified : le mobile recevra
            # les suppressions dans la liste "deleted" du prochain pull.
            progs_a_supprimer = list(
                Programme.objects.filter(
                    date_programme=date_prog,
                    utilisateur__in=livreurs,
                    is_deleted=False,
                ).values_list("id", flat=True)
            )
            Anomalie.objects.filter(programme_id__in=progs_a_supprimer, is_deleted=False).update(is_deleted=True)
            count = Programme.objects.filter(id__in=progs_a_supprimer).update(is_deleted=True)
            self.stdout.write(self.style.WARNING(
                f"Reset : {count} programme(s) marqué(s) supprimés (soft-delete)."
            ))

        # Scénario forcé ou aléatoire pour chaque livreur
        type_force = options.get("type")
        if type_force == "COL":
            scenarios_forcat = [[TypeProgramme.COLLECTE]]
        elif type_force == "RES":
            scenarios_forcat = [[TypeProgramme.RESTITUTION]]
        elif type_force == "LES2":
            scenarios_forcat = [[TypeProgramme.COLLECTE, TypeProgramme.RESTITUTION]]
        else:
            scenarios_forcat = None  # aléatoire par livreur

        heure_base = datetime.now()
        compteur   = 0

        # Partitionner les PLV par client, puis distribuer les groupes-clients aux
        # livreurs en round-robin. Un même client ne peut apparaître que dans
        # les programmes d'un seul livreur sur la journée (évite les conflits).
        _tmp: dict = defaultdict(list)
        for plv in plvs:
            _tmp[plv.client_id].append(plv)
        groupes_client = list(_tmp.values())
        random.shuffle(groupes_client)

        pool_livreur: dict[int, list] = defaultdict(list)
        for i, groupe in enumerate(groupes_client):
            livreur_dest = livreurs[i % len(livreurs)]
            pool_livreur[livreur_dest.id].extend(groupe)

        with transaction.atomic():
            taches = []
            for livreur in livreurs:
                types = (
                    random.choices(_SCENARIOS, weights=_POIDS, k=1)[0]
                    if scenarios_forcat is None
                    else scenarios_forcat[0]
                )
                for type_prog in types:
                    taches.append((livreur, type_prog))

            for idx, (livreur, type_prog) in enumerate(taches):
                prefix    = f"PRG-{type_prog[:3]}-{date_prog.strftime('%Y%m%d')}-"
                numero_x3 = _numero_libre(prefix, heure_base + timedelta(seconds=idx))
                vehicule  = random.choice(vehicules) if vehicules else None

                programme = Programme.objects.create(
                    numero_x3=numero_x3,
                    utilisateur=livreur,
                    vehicule=vehicule,
                    date_programme=date_prog,
                    type_programme=type_prog,
                    statut=StatutProgramme.PLANIFIE,
                )

                # Pool de PLVs du livreur (clients dédiés par round-robin).
                # Fallback sur le pool global si le pool individuel est trop petit.
                mon_pool  = pool_livreur[livreur.id] or plvs
                nb_etapes = random.randint(3, min(5, len(mon_pool)))
                plvs_choisis = random.sample(mon_pool, nb_etapes)

                for ordre, plv in enumerate(plvs_choisis, start=1):
                    etape = Etape.objects.create(
                        programme=programme,
                        plv=plv,
                        ordre_prevu=ordre,
                    )
                    # COLLECTE : pas de LigneProgramme : quantités non planifiées à l'avance.
                    # RESTITUTION : lignes G* avec quantite_prevue (livraison de gaz plein).
                    if type_prog == TypeProgramme.RESTITUTION:
                        nb_articles = random.randint(1, min(3, len(articles_gaz)))
                        for prod in random.sample(articles_gaz, nb_articles):
                            LigneProgramme.objects.create(
                                etape=etape,
                                produit=prod,
                                quantite_prevue=random.randint(5, 30),
                            )

                # Calculer et persister l'ordre optimisé (plus proche voisin)
                appliquer_ordre_optimise(programme)

                # Anomalie de démo générée lors d'un --reset (données réalistes)
                if options["reset"]:
                    plv_anomalie = random.choice(plvs_choisis)
                    Anomalie.objects.create(
                        uuid=uuid.uuid4(),
                        programme=programme,
                        plv=plv_anomalie,
                        type_anomalie=random.choice(_TYPES_ANOMALIE),
                        gravite=random.choice([GraviteAnomalie.FAIBLE, GraviteAnomalie.MOYENNE, GraviteAnomalie.ELEVEE]),
                        description="Anomalie générée automatiquement pour la démonstration.",
                        statut=StatutAnomalie.OUVERTE,
                        date_heure=timezone.now(),
                    )

                compteur += 1
                self.stdout.write(
                    f"  {livreur.code_livreur} : {numero_x3} ({type_prog}, {nb_etapes} étapes)"
                )

        self.stdout.write(
            self.style.SUCCESS(f"\n{compteur} programme(s) généré(s) pour le {date_prog}.")
        )
