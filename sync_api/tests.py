"""
Tests du moteur de synchronisation offline-first.

Couvre les trois invariants critiques documentés dans le mémoire :
  1. Isolation livreur    — un livreur ne voit/modifie QUE ses propres données.
  2. Idempotence du push  — rejouer le même payload ne crée pas de doublon.
  3. Delta pull           — seuls les enregistrements modifiés depuis lastPulledAt
                            sont renvoyés.

On teste SyncEngine directement (pas via HTTP) : l'API HTTP est triviale
(validation de payload + délégation à SyncEngine).

La base de test PostgreSQL hérite des migrations, donc les triggers
last_modified et la vue v_reconciliation_etape sont présents.

Exécution :
    python manage.py test sync_api
"""
import time
from datetime import date

from django.contrib.gis.geos import Point
from django.test import TestCase
from rest_framework import status

from accounts.models import Role, Utilisateur
from distribution.models import (
    Article, Client, Etape, Operation, Plv, Programme,
)
from sync_api.engine import SyncEngine


# ---------------------------------------------------------------------------
# Helpers : création d'objets minimaux pour les tests
# ---------------------------------------------------------------------------

def _utilisateur(code: str) -> Utilisateur:
    return Utilisateur.objects.create_user(
        username=f'user_{code.lower()}',
        password='test1234',
        code_livreur=code,
        role=Role.LIVREUR,
    )


def _programme(user: Utilisateur, numero: str = 'PROG-TEST') -> Programme:
    return Programme.objects.create(
        utilisateur=user,
        numero_x3=numero,
        date_programme=date.today(),
        type_programme='COLLECTE',
    )


def _plv() -> Plv:
    client = Client.objects.create(
        code_x3='CLI-TEST',
        raison_sociale='Client Test',
        type_client='PARTICULIER',
    )
    return Plv.objects.create(
        client=client,
        libelle='PLV Test',
        localisation=Point(-1.523, 12.365, srid=4326),
    )


def _etape(programme: Programme, plv: Plv, ordre: int = 1) -> Etape:
    return Etape.objects.create(
        programme=programme,
        plv=plv,
        ordre_prevu=ordre,
    )


def _article(code: str = 'B12_5') -> Article:
    return Article.objects.create(
        code_x3=code,
        libelle='Bouteille 12,5 kg',
        type_emballage='B12_5',
        prix_unitaire=3000,
    )


def _op_payload(etape_uuid: str, op_uuid: str = 'aaaaaaaa-0001-0001-0001-000000000001') -> dict:
    """Payload push minimal pour une opération COLLECTE valide."""
    return {
        'operation': {
            'created': [{
                'uuid':             op_uuid,
                'etape_uuid':       etape_uuid,
                'type_operation':   'COLLECTE',
                'sous_type':        'BCR',
                'date_heure':       '2026-06-11T08:00:00Z',
                'montant_total':    15000,
                'montant_encaisse': 15000,
                'est_encaissee':    True,
            }],
            'updated': [],
            'deleted': [],
        },
        'ligne_operation': {'created': [], 'updated': [], 'deleted': []},
        'anomalie':        {'created': [], 'updated': [], 'deleted': []},
        'photo':           {'created': [], 'updated': [], 'deleted': []},
    }


# ===========================================================================
# 1. DELTA PULL
# ===========================================================================

class TestSyncEnginePull(TestCase):
    """
    Vérifie que build_pull_response() renvoie le bon delta :
    tout au premier pull (lastPulledAt=0), rien si aucun changement récent,
    et uniquement les données du livreur connecté.
    """

    def setUp(self):
        self.user = _utilisateur('TST001')
        self.prog = _programme(self.user)
        plv = _plv()
        _etape(self.prog, plv)
        self.engine = SyncEngine(self.user)

    def test_premier_pull_retourne_le_programme(self):
        """lastPulledAt=0 : premier pull complet, le programme doit apparaître."""
        response = self.engine.build_pull_response(0)
        self.assertEqual(response.status_code, 200)
        programmes = response.data['changes']['programme']
        uuids = [str(p['uuid']) for p in programmes['updated']]
        self.assertIn(str(self.prog.uuid), uuids)

    def test_pull_incremental_vide_sans_changement(self):
        """Un timestamp futur ne doit retourner aucun enregistrement."""
        ts_futur = int(time.time() * 1000) + 999_999_000
        response = self.engine.build_pull_response(ts_futur)
        self.assertEqual(response.status_code, 200)
        changes = response.data['changes']
        self.assertEqual(len(changes['programme']['updated']), 0)
        self.assertEqual(len(changes['etape']['updated']), 0)

    def test_pull_isole_par_livreur(self):
        """Un second livreur ne doit pas voir les programmes de TST001."""
        autre = _utilisateur('TST002')
        response = SyncEngine(autre).build_pull_response(0)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['changes']['programme']['updated']), 0)


# ===========================================================================
# 2. IDEMPOTENCE DU PUSH
# ===========================================================================

class TestSyncEnginePushIdempotence(TestCase):
    """
    Vérifie qu'un même payload rejoué n'introduit pas de doublons
    (update_or_create par UUID côté serveur).
    """

    def setUp(self):
        self.user = _utilisateur('TST001')
        self.prog = _programme(self.user)
        plv = _plv()
        self.etape = _etape(self.prog, plv)
        self.engine = SyncEngine(self.user)

    def test_push_cree_operation_et_passe_etape_visitee(self):
        """Un push réussi crée l'opération et passe l'étape à VISITEE."""
        payload = _op_payload(str(self.etape.uuid))
        response = self.engine.apply_push(payload, [])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['applied']['operation']['created'], 1)
        self.assertEqual(Operation.objects.count(), 1)
        self.etape.refresh_from_db()
        self.assertEqual(self.etape.statut_visite, 'VISITEE')

    def test_push_idempotent_pas_de_doublon(self):
        """
        Pousser deux fois le même UUID ne doit pas créer de doublon.
        Le second push doit comptabiliser 1 updated, pas 1 created.
        """
        payload = _op_payload(str(self.etape.uuid))
        self.engine.apply_push(payload, [])

        engine2 = SyncEngine(self.user)
        response2 = engine2.apply_push(payload, [])

        self.assertEqual(response2.status_code, status.HTTP_200_OK)
        self.assertEqual(response2.data['applied']['operation']['created'], 0)
        self.assertEqual(response2.data['applied']['operation']['updated'], 1)
        # Un seul enregistrement en base, pas deux.
        self.assertEqual(Operation.objects.count(), 1)

    def test_push_echec_etapes_marque_statut(self):
        """Les UUIDs dans echec_etapes doivent passer statut_visite à ECHEC."""
        response = self.engine.apply_push(
            {'operation': {'created': [], 'updated': [], 'deleted': []},
             'ligne_operation': {'created': [], 'updated': [], 'deleted': []},
             'anomalie':        {'created': [], 'updated': [], 'deleted': []},
             'photo':           {'created': [], 'updated': [], 'deleted': []}},
            echec_etapes=[str(self.etape.uuid)],
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.etape.refresh_from_db()
        self.assertEqual(self.etape.statut_visite, 'ECHEC')


# ===========================================================================
# 3. ISOLATION LIVREUR
# ===========================================================================

class TestSyncEnginePushIsolation(TestCase):
    """
    Vérifie qu'un livreur ne peut pas créer d'opération sur l'étape
    d'un autre livreur (refus 403), ni sur une étape inexistante.
    """

    def setUp(self):
        self.user1 = _utilisateur('TST001')
        self.user2 = _utilisateur('TST002')
        prog2 = _programme(self.user2, 'PROG-LIV2')
        plv = _plv()
        self.etape_user2 = _etape(prog2, plv)

    def test_push_refuse_etape_autre_livreur(self):
        """
        Livreur 1 tente de pousser sur l'étape de Livreur 2 → 403.
        Aucune opération ne doit être créée en base.
        """
        payload = _op_payload(str(self.etape_user2.uuid))
        response = SyncEngine(self.user1).apply_push(payload, [])

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Operation.objects.count(), 0)

    def test_push_ignore_etape_inconnue(self):
        """
        Un UUID d'étape qui n'existe pas dans la base → ignoré silencieusement,
        aucune erreur 500, 0 opération créée.
        """
        uuid_inconnu = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
        payload = _op_payload(uuid_inconnu)
        response = SyncEngine(self.user1).apply_push(payload, [])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Operation.objects.count(), 0)
