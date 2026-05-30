# Scénario de test de l'API de synchronisation

Ce document déroule un cycle complet de synchronisation : login → pull initial → simulation de saisie hors ligne → push → vérification.

Tu lances les commandes l'une après l'autre dans un terminal Ubuntu, après avoir démarré `python manage.py runserver` dans un autre terminal.

## Étape 0 — Préparation

Vérifie qu'il existe des données et que tu as un programme du jour pour LIV001 :

```bash
# Si pas encore fait :
python manage.py seed_demo
python manage.py generer_programmes_du_jour
```

## Étape 1 — Login et récupération du token

```bash
RESPONSE=$(curl -s -X POST http://localhost:8000/api/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"code_livreur": "LIV001", "password": "demo1234"}')

echo "$RESPONSE"

# Extraction de l'access token dans une variable shell
ACCESS=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['access'])")
echo "ACCESS = $ACCESS"
```

À la fin tu dois voir un long token JWT dans `$ACCESS`.

## Étape 2 — Pull initial (lastPulledAt = 0)

```bash
curl -s -X POST http://localhost:8000/api/sync/pull/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"lastPulledAt": 0}' \
  | python3 -m json.tool
```

Tu dois recevoir un JSON contenant :
- `changes.client.updated` : 3 clients
- `changes.plv.updated` : 5 PLV
- `changes.produit.updated` : 3 produits
- `changes.programme.updated` : le programme du jour de LIV001
- `changes.etape.updated` : 3 à 5 étapes
- `changes.ligne_programme.updated` : éventuellement des lignes si c'est un programme RESTITUTION
- `changes.operation.updated` : vide (aucune opération encore)
- `timestamp` : un grand nombre (epoch ms du serveur)

**Note la valeur de `timestamp`**, on l'utilisera ensuite. Tu peux la stocker dans une variable :

```bash
TIMESTAMP=$(curl -s -X POST http://localhost:8000/api/sync/pull/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"lastPulledAt": 0}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['timestamp'])")
echo "TIMESTAMP = $TIMESTAMP"
```

Note également l'UUID d'une des étapes (tu en auras besoin pour le push). Récupère-le ainsi :

```bash
ETAPE_UUID=$(curl -s -X POST http://localhost:8000/api/sync/pull/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"lastPulledAt": 0}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['changes']['etape']['updated'][0]['uuid'])")
echo "ETAPE_UUID = $ETAPE_UUID"
```

## Étape 3 — Pull immédiatement après (incrémental)

Re-lance le pull en passant le timestamp obtenu. Il ne doit rien renvoyer (incrémental fonctionne).

```bash
curl -s -X POST http://localhost:8000/api/sync/pull/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d "{\"lastPulledAt\": $TIMESTAMP}" \
  | python3 -m json.tool
```

Toutes les listes `created`, `updated`, `deleted` doivent être vides. Le nouveau `timestamp` est légèrement plus grand que le précédent.

## Étape 4 — Push d'une opération créée hors ligne

On simule qu'un livreur a saisi une opération de collecte sur une étape. Tu vas remonter une opération avec une ligne. Génère un UUID pour l'opération et un autre pour la ligne :

```bash
OP_UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
LIGNE_UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
echo "OP_UUID = $OP_UUID"
echo "LIGNE_UUID = $LIGNE_UUID"
```

Puis le push :

```bash
curl -s -X POST http://localhost:8000/api/sync/push/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d "{
    \"lastPulledAt\": $TIMESTAMP,
    \"changes\": {
      \"operation\": {
        \"created\": [{
          \"uuid\": \"$OP_UUID\",
          \"etape_uuid\": \"$ETAPE_UUID\",
          \"type_operation\": \"COLLECTE\",
          \"sous_type\": \"BCR\",
          \"date_heure\": \"2026-05-29T14:30:00Z\",
          \"latitude\": 12.3650,
          \"longitude\": -1.5236,
          \"mode_paiement\": \"ESPECES\",
          \"montant_total\": 7000,
          \"montant_encaisse\": 7000,
          \"est_encaissee\": true,
          \"nom_signataire_client\": \"M. OUATTARA\"
        }]
      },
      \"ligne_operation\": {
        \"created\": [{
          \"uuid\": \"$LIGNE_UUID\",
          \"operation_uuid\": \"$OP_UUID\",
          \"produit_code_x3\": \"B6-PLEINE\",
          \"quantite_realisee\": 2,
          \"montant_ligne\": 7000
        }]
      }
    }
  }" | python3 -m json.tool
```

Réponse attendue :
```json
{
    "status": "ok",
    "applied": {
        "operation": {"created": 1, "updated": 0, "deleted": 0},
        "ligne_operation": {"created": 1, "updated": 0, "deleted": 0},
        "anomalie": {"created": 0, "updated": 0, "deleted": 0}
    }
}
```

## Étape 5 — Idempotence : rejouer le même push

Re-lance exactement le même push. La réponse doit indiquer `updated: 1` au lieu de `created: 1` — l'opération n'a pas été dupliquée, elle a été mise à jour.

```bash
# (relance la même commande curl que l'étape 4)
```

## Étape 6 — Vérification en base via l'admin

Va sur http://localhost:8000/admin/ → Operations. Tu dois voir une opération de type COLLECTE / BCR, avec montant 7000, etc. Ouvre-la : tu verras la ligne d'opération en inline avec la quantité.

## Étape 7 — Vérifier la sécurité : un autre livreur ne peut pas pousser

Connecte-toi en tant que LIV002 (Salif) :

```bash
RESPONSE2=$(curl -s -X POST http://localhost:8000/api/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"code_livreur": "LIV002", "password": "demo1234"}')
ACCESS2=$(echo "$RESPONSE2" | python3 -c "import sys, json; print(json.load(sys.stdin)['access'])")
```

Essaie de pousser sur l'étape de LIV001 (qui ne lui appartient pas) :

```bash
OP_UUID_2=$(python3 -c "import uuid; print(uuid.uuid4())")

curl -s -X POST http://localhost:8000/api/sync/push/ \
  -H "Authorization: Bearer $ACCESS2" \
  -H "Content-Type: application/json" \
  -d "{
    \"lastPulledAt\": 0,
    \"changes\": {
      \"operation\": {
        \"created\": [{
          \"uuid\": \"$OP_UUID_2\",
          \"etape_uuid\": \"$ETAPE_UUID\",
          \"type_operation\": \"COLLECTE\",
          \"sous_type\": \"BCR\",
          \"date_heure\": \"2026-05-29T15:00:00Z\",
          \"montant_total\": 0,
          \"montant_encaisse\": 0,
          \"est_encaissee\": false
        }]
      }
    }
  }" | python3 -m json.tool
```

Tu dois recevoir un HTTP 403 avec `"detail": "Etape <uuid> introuvable ou non autorisee."`. Le filtrage par utilisateur fonctionne.

## Étape 8 — Pull après push : on récupère ce qu'on a poussé

Reviens en tant que LIV001 et fais un pull en passant un `lastPulledAt` antérieur :

```bash
curl -s -X POST http://localhost:8000/api/sync/pull/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"lastPulledAt": 0}' \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
print('Operations:', len(data['changes']['operation']['updated']))
print('Lignes_operation:', len(data['changes']['ligne_operation']['updated']))
"
```

Tu dois voir :
```
Operations: 1
Lignes_operation: 1
```

L'opération créée précédemment est bien lue par le pull. Cycle complet validé.

---

## Si un test échoue

Copie-colle le message d'erreur exact dans la conversation. Les points de friction probables :

- **HTTP 400** sur le push : structure du JSON. Vérifie que tu as bien échappé les variables shell entre crochets.
- **HTTP 403** sur l'étape 4 : le filtrage par utilisateur croit que tu n'es pas le bon livreur. Vérifie que `$ACCESS` est bien le token de LIV001.
- **HTTP 500** : exception côté serveur. Le terminal de `runserver` doit afficher le traceback.
