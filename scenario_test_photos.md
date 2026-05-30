# Scénario de test de l'upload de photos

Ce scénario suppose que tu as déjà déroulé le scénario de test de la sync, et qu'il y a une opération en base avec un UUID que tu connais.

## Étape 0 — Préparation

Si tu as encore le terminal de tests sync, tu as déjà tes variables `ACCESS` et `OP_UUID`. Sinon, relance :

```bash
RESPONSE=$(curl -s -X POST http://localhost:8000/api/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"code_livreur": "LIV001", "password": "demo1234"}')
ACCESS=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['access'])")

# Recuperer l'UUID d'une operation existante via le pull
OP_UUID=$(curl -s -X POST http://localhost:8000/api/sync/pull/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"lastPulledAt": 0}' \
  | python3 -c "import sys, json; d=json.load(sys.stdin); ops=d['changes']['operation']['updated']; print(ops[0]['uuid']) if ops else print('AUCUNE_OP')")

echo "OP_UUID = $OP_UUID"
```

Si tu vois `AUCUNE_OP`, refais d'abord le scénario sync pour créer une opération.

## Étape 1 — Créer l'enregistrement Photo via push JSON

D'abord on enregistre la métadonnée de la photo (sans encore envoyer le fichier).

```bash
PHOTO_UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
echo "PHOTO_UUID = $PHOTO_UUID"

curl -s -X POST http://localhost:8000/api/sync/push/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d "{
    \"lastPulledAt\": 0,
    \"changes\": {
      \"photo\": {
        \"created\": [{
          \"uuid\": \"$PHOTO_UUID\",
          \"operation_uuid\": \"$OP_UUID\",
          \"type_photo\": \"LIVRAISON\",
          \"date_heure\": \"2026-05-29T14:35:00Z\",
          \"latitude\": 12.3650,
          \"longitude\": -1.5236,
          \"taille_octets\": 245000
        }]
      }
    }
  }" | python3 -m json.tool
```

Tu dois voir `"photo": {"created": 1, ...}` dans la réponse. L'enregistrement Photo existe en base, mais le fichier est un placeholder.

## Étape 2 — Préparer un fichier image de test

Crée une image fictive de test :

```bash
# Petite image PNG de test (1 pixel rouge), 70 octets environ
python3 -c "
import base64
data = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==')
open('/tmp/test_photo.png', 'wb').write(data)
print('OK')
"
```

## Étape 3 — Upload du fichier binaire

```bash
curl -s -X POST "http://localhost:8000/api/sync/photos/$PHOTO_UUID/upload/" \
  -H "Authorization: Bearer $ACCESS" \
  -F "fichier=@/tmp/test_photo.png" \
  | python3 -m json.tool
```

Tu dois recevoir :
```json
{
    "status": "ok",
    "uuid": "...",
    "url": "http://localhost:8000/media/photos/2026/05/29/test_photo.png",
    "taille_octets": 70
}
```

## Étape 4 — Vérifier que le fichier est accessible

Ouvre l'URL retournée dans ton navigateur. Tu dois voir l'image (un seul pixel rouge, très petit).

## Étape 5 — Vérifier en base via l'admin

Va sur http://localhost:8000/admin/ → Photos → clique sur celle qui vient d'être créée. Tu vois le champ `fichier` qui pointe vers le bon chemin, et la `taille_octets` mise à jour.

## Étape 6 — Vérifier la sécurité

Tente d'uploader avec le token de LIV002 (Salif), qui ne possède pas cette photo :

```bash
RESPONSE2=$(curl -s -X POST http://localhost:8000/api/auth/login/ \
  -H 'Content-Type: application/json' \
  -d '{"code_livreur": "LIV002", "password": "demo1234"}')
ACCESS2=$(echo "$RESPONSE2" | python3 -c "import sys, json; print(json.load(sys.stdin)['access'])")

curl -s -X POST "http://localhost:8000/api/sync/photos/$PHOTO_UUID/upload/" \
  -H "Authorization: Bearer $ACCESS2" \
  -F "fichier=@/tmp/test_photo.png" \
  | python3 -m json.tool
```

Tu dois recevoir un 404 : `"detail": "Photo introuvable ou non autorisee."`. Le filtrage par utilisateur fonctionne.

## Étape 7 — Tester aussi avec une anomalie

Crée une anomalie via push JSON, puis une photo rattachée à cette anomalie. Même flux qu'aux étapes 1 à 5, mais avec `anomalie_uuid` au lieu d'`operation_uuid` dans le payload de la photo.

```bash
# Recuperer un programme du livreur via pull
PROG_UUID=$(curl -s -X POST http://localhost:8000/api/sync/pull/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"lastPulledAt": 0}' \
  | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['changes']['programme']['updated'][0]['uuid'])")

ANO_UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
PHOTO_ANO_UUID=$(python3 -c "import uuid; print(uuid.uuid4())")

# Push de l'anomalie ET de sa photo en une seule requete
curl -s -X POST http://localhost:8000/api/sync/push/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d "{
    \"lastPulledAt\": 0,
    \"changes\": {
      \"anomalie\": {
        \"created\": [{
          \"uuid\": \"$ANO_UUID\",
          \"programme_uuid\": \"$PROG_UUID\",
          \"type_anomalie\": \"PLV ferme\",
          \"gravite\": \"MOYENNE\",
          \"description\": \"Boutique fermee a notre arrivee, aucun contact possible.\",
          \"date_heure\": \"2026-05-29T15:00:00Z\"
        }]
      },
      \"photo\": {
        \"created\": [{
          \"uuid\": \"$PHOTO_ANO_UUID\",
          \"anomalie_uuid\": \"$ANO_UUID\",
          \"type_photo\": \"ANOMALIE\",
          \"date_heure\": \"2026-05-29T15:00:30Z\"
        }]
      }
    }
  }" | python3 -m json.tool

# Upload du fichier de la photo d'anomalie
curl -s -X POST "http://localhost:8000/api/sync/photos/$PHOTO_ANO_UUID/upload/" \
  -H "Authorization: Bearer $ACCESS" \
  -F "fichier=@/tmp/test_photo.png" \
  | python3 -m json.tool
```

Tu dois voir l'anomalie créée, sa photo créée, puis l'upload accepté. Va sur la supervision (`http://localhost:8000/supervision/anomalies/`) tu verras l'anomalie listée.

## Étape 8 — Test final : protection d'exclusivité

Essaie de créer une photo rattachée aux deux à la fois (operation_uuid ET anomalie_uuid). Le serializer doit refuser :

```bash
curl -s -X POST http://localhost:8000/api/sync/push/ \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d "{
    \"lastPulledAt\": 0,
    \"changes\": {
      \"photo\": {
        \"created\": [{
          \"uuid\": \"$(python3 -c 'import uuid; print(uuid.uuid4())')\",
          \"operation_uuid\": \"$OP_UUID\",
          \"anomalie_uuid\": \"$ANO_UUID\",
          \"type_photo\": \"LIVRAISON\",
          \"date_heure\": \"2026-05-29T16:00:00Z\"
        }]
      }
    }
  }" | python3 -m json.tool
```

Tu dois recevoir une erreur 400 du style :
```
"non_field_errors": ["Une photo doit etre rattachee soit a une operation, soit a une anomalie, mais pas aux deux."]
```

La contrainte d'exclusivité, qu'on avait définie en base ET en serializer, fait son travail.

---

## Si un test échoue

Comme d'habitude, copie-colle le message d'erreur. Les points de friction probables :

- **HTTP 500 sur l'upload** : problème de droits sur le dossier `media/`. Vérifie avec `ls -la ~/sodigaz_poc/media`. Si le dossier n'existe pas, Django le créera tout seul au premier upload, mais le compte du serveur doit avoir le droit d'écrire dans `~/sodigaz_poc/`.
- **TemplateError sur la supervision après ce changement** : non, on ne touche pas à la supervision dans cette installation.
- **"placeholder.bin" introuvable dans l'admin** : c'est normal et attendu si tu regardes une photo créée par push avant son upload. Le fichier physique n'existera qu'après l'étape 3.
