#!/bin/bash
# =============================================================================
# Installation de l'endpoint d'upload de photos
#   POST /api/sync/photos/<uuid>/upload    : upload d'une photo en multipart
# Usage : depuis ~/sodigaz_poc, bash install_photos_upload.sh
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
echo "=== Etape 1 : ajout de la vue d'upload dans sync_api/views.py ==="

if grep -q "def upload_photo" sync_api/views.py; then
    echo "  = upload_photo deja present, ignore"
else

# Ajout au tout debut du fichier (apres les imports existants), une vue
# upload_photo, plus le serializer push pour photos via JSON (creation
# d'enregistrement Photo sans le fichier).

python3 << 'PYEOF'
from pathlib import Path

# 1. Ajouter PhotoPushSerializer dans push_serializers.py
push_path = Path("sync_api/push_serializers.py")
push_content = push_path.read_text()

if "PhotoPushSerializer" not in push_content:
    addition = '''

class PhotoPushSerializer(serializers.Serializer):
    """
    Pour le push JSON de l'enregistrement Photo (metadonnees uniquement).
    Le fichier binaire est upload separement via POST /api/sync/photos/<uuid>/upload.

    Contrainte : operation_uuid OU anomalie_uuid renseigne, jamais les deux.
    """
    uuid = serializers.UUIDField()
    operation_uuid = serializers.UUIDField(required=False, allow_null=True)
    anomalie_uuid = serializers.UUIDField(required=False, allow_null=True)
    type_photo = serializers.ChoiceField(
        choices=["BORDEREAU", "LIVRAISON", "ETAT_PLV", "ANOMALIE"]
    )
    date_heure = serializers.DateTimeField()
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    taille_octets = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        op = attrs.get("operation_uuid")
        an = attrs.get("anomalie_uuid")
        if bool(op) == bool(an):
            raise serializers.ValidationError(
                "Une photo doit etre rattachee soit a une operation, soit "
                "a une anomalie, mais pas aux deux."
            )
        return attrs
'''
    push_content += addition
    push_path.write_text(push_content)
    print("  + PhotoPushSerializer ajoute a push_serializers.py")
else:
    print("  = PhotoPushSerializer deja present")

# 2. Modifier views.py : ajouter l'import de PhotoPushSerializer, le handler
# de push photo dans sync_push, et la vue upload_photo.

views_path = Path("sync_api/views.py")
content = views_path.read_text()

# 2a. Ajout de l'import PhotoPushSerializer dans la liste d'imports existante
content = content.replace(
    "from .push_serializers import (\n"
    "    AnomaliePushSerializer,\n"
    "    LigneOperationPushSerializer,\n"
    "    OperationPushSerializer,\n"
    "    PushPayloadSerializer,\n"
    ")",
    "from .push_serializers import (\n"
    "    AnomaliePushSerializer,\n"
    "    LigneOperationPushSerializer,\n"
    "    OperationPushSerializer,\n"
    "    PhotoPushSerializer,\n"
    "    PushPayloadSerializer,\n"
    ")",
)

# 2b. Ajout de Photo dans les imports de modeles
content = content.replace(
    "from distribution.models import (\n"
    "    Anomalie,\n"
    "    Client,\n"
    "    Etape,\n"
    "    LigneOperation,\n"
    "    LigneProgramme,\n"
    "    Operation,\n"
    "    Plv,\n"
    "    Produit,\n"
    "    Programme,\n"
    "    Vehicule,\n"
    ")",
    "from distribution.models import (\n"
    "    Anomalie,\n"
    "    Client,\n"
    "    Etape,\n"
    "    LigneOperation,\n"
    "    LigneProgramme,\n"
    "    Operation,\n"
    "    Photo,\n"
    "    Plv,\n"
    "    Produit,\n"
    "    Programme,\n"
    "    Vehicule,\n"
    ")",
)

# 2c. Ajouter la cle 'photo' dans le dict applied au debut de sync_push
content = content.replace(
    'applied = {\n'
    '        "operation": {"created": 0, "updated": 0, "deleted": 0},\n'
    '        "ligne_operation": {"created": 0, "updated": 0, "deleted": 0},\n'
    '        "anomalie": {"created": 0, "updated": 0, "deleted": 0},\n'
    '    }',
    'applied = {\n'
    '        "operation": {"created": 0, "updated": 0, "deleted": 0},\n'
    '        "ligne_operation": {"created": 0, "updated": 0, "deleted": 0},\n'
    '        "anomalie": {"created": 0, "updated": 0, "deleted": 0},\n'
    '        "photo": {"created": 0, "updated": 0, "deleted": 0},\n'
    '    }',
)

# 2d. Ajouter le bloc de traitement des photos a la fin du try/with atomic,
# juste avant le 'except PermissionError'. On insere apres le bloc de
# suppression des anomalies (qui se termine par
# "applied["anomalie"]["deleted"] += updated").
photo_block = '''
            # ----- PHOTOS (metadonnees uniquement, fichier binaire upload separement) -----
            for photo_data in (
                changes.get("photo", {}).get("created", [])
                + changes.get("photo", {}).get("updated", [])
            ):
                ph_serializer = PhotoPushSerializer(data=photo_data)
                ph_serializer.is_valid(raise_exception=True)
                d = ph_serializer.validated_data

                operation_id = None
                anomalie_id = None
                if d.get("operation_uuid"):
                    op = Operation.objects.filter(
                        uuid=d["operation_uuid"],
                        etape__programme__utilisateur=user,
                    ).first()
                    if op is None:
                        raise PermissionError(
                            f"Operation {d['operation_uuid']} introuvable ou non autorisee."
                        )
                    operation_id = op.id
                else:
                    an = Anomalie.objects.filter(
                        uuid=d["anomalie_uuid"],
                        programme__utilisateur=user,
                    ).first()
                    if an is None:
                        raise PermissionError(
                            f"Anomalie {d['anomalie_uuid']} introuvable ou non autorisee."
                        )
                    anomalie_id = an.id

                # update_or_create : le fichier reste vide pour l'instant,
                # il sera renseigne par l'endpoint d'upload binaire dedie.
                # On preserve un eventuel fichier deja upload (par un cycle precedent).
                existing = Photo.objects.filter(uuid=d["uuid"]).first()
                defaults = {
                    "operation_id": operation_id,
                    "anomalie_id": anomalie_id,
                    "type_photo": d["type_photo"],
                    "date_heure": d["date_heure"],
                    "taille_octets": d.get("taille_octets"),
                    "is_deleted": False,
                }
                if d.get("latitude") is not None and d.get("longitude") is not None:
                    defaults["localisation"] = Point(d["longitude"], d["latitude"], srid=4326)

                if existing:
                    for k, v in defaults.items():
                        setattr(existing, k, v)
                    existing.save()
                    applied["photo"]["updated"] += 1
                else:
                    # fichier est requis par le modele (ImageField sans null=True),
                    # on cree un nom de placeholder le temps que l'upload arrive.
                    Photo.objects.create(uuid=d["uuid"], fichier="placeholder.bin", **defaults)
                    applied["photo"]["created"] += 1

            for uuid_to_delete in changes.get("photo", {}).get("deleted", []):
                # On filtre sur le user via la chaine soit operation, soit anomalie
                photos = Photo.objects.filter(uuid=uuid_to_delete).filter(
                    models.Q(operation__etape__programme__utilisateur=user)
                    | models.Q(anomalie__programme__utilisateur=user)
                )
                updated = photos.update(is_deleted=True)
                applied["photo"]["deleted"] += updated
'''

# Insertion du bloc juste avant 'except PermissionError'
content = content.replace(
    '    except PermissionError as e:',
    photo_block + '\n    except PermissionError as e:',
    1,
)

# 2e. Ajouter import de models pour Q (utilise dans le bloc photo)
if "from django.db import transaction" in content and "from django.db import models" not in content:
    content = content.replace(
        "from django.db import transaction",
        "from django.db import models, transaction",
    )

# 2f. Ajouter la vue upload_photo a la fin du fichier
upload_view = '''

# ===========================================================================
# UPLOAD DU FICHIER BINAIRE D'UNE PHOTO
# ===========================================================================

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_photo(request, uuid):
    """
    Upload du fichier binaire d'une photo dont l'enregistrement existe deja
    cote serveur (cree au prealable via sync_push).

    URL : POST /api/sync/photos/<uuid>/upload/
    Body : multipart/form-data, champ 'fichier'

    Le livreur ne peut uploader que sur ses propres photos.
    """
    if "fichier" not in request.FILES:
        return Response(
            {"detail": "Champ 'fichier' manquant dans le multipart."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Recherche de la photo, en filtrant par autorisation utilisateur
    photo = Photo.objects.filter(uuid=uuid).filter(
        models.Q(operation__etape__programme__utilisateur=request.user)
        | models.Q(anomalie__programme__utilisateur=request.user)
    ).first()

    if photo is None:
        return Response(
            {"detail": "Photo introuvable ou non autorisee."},
            status=status.HTTP_404_NOT_FOUND,
        )

    fichier = request.FILES["fichier"]
    photo.fichier = fichier
    photo.taille_octets = fichier.size
    photo.save()

    return Response({
        "status": "ok",
        "uuid": str(photo.uuid),
        "url": request.build_absolute_uri(photo.fichier.url),
        "taille_octets": photo.taille_octets,
    }, status=status.HTTP_200_OK)
'''

content += upload_view
views_path.write_text(content)
print("  + views.py mise a jour")
PYEOF

fi

# =============================================================================
echo ""
echo "=== Etape 2 : ajout de la route d'upload ==="

if grep -q "upload_photo" sync_api/urls.py; then
    echo "  = route deja presente"
else
    python3 << 'PYEOF'
from pathlib import Path
urls_path = Path("sync_api/urls.py")
content = urls_path.read_text()
content = content.replace(
    'path("push/", views.sync_push, name="push"),',
    'path("push/", views.sync_push, name="push"),\n'
    '    path("photos/<uuid:uuid>/upload/", views.upload_photo, name="photo-upload"),',
)
urls_path.write_text(content)
print("  + route /api/sync/photos/<uuid>/upload/ ajoutee")
PYEOF
fi

# =============================================================================
echo ""
echo "=== Etape 3 : configuration du stockage des medias ==="

python3 << 'PYEOF'
from pathlib import Path
import re

# config/settings.py contient deja MEDIA_URL et MEDIA_ROOT,
# mais il faut servir les medias en dev via config/urls.py.
settings_path = Path("config/settings.py")
content = settings_path.read_text()

if 'FILE_UPLOAD_MAX_MEMORY_SIZE' not in content:
    content += '''

# Limite de taille pour les uploads (5 Mo par photo, plus que suffisant
# pour une photo compressee cote mobile)
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024  # 5 Mo
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 Mo (pour le JSON sync)
'''
    settings_path.write_text(content)
    print("  + limites d'upload ajoutees")
else:
    print("  = limites deja presentes")

# config/urls.py : servir les medias en dev
urls_path = Path("config/urls.py")
content = urls_path.read_text()

if "static(settings.MEDIA_URL" not in content:
    new_content = '''from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("auth_api.urls")),
    path("api/mock-x3/", include("mock_x3.urls")),
    path("api/sync/", include("sync_api.urls")),
    path("supervision/", include("supervision.urls")),
]

# Servir les medias en developpement (en production, c'est nginx)
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
'''
    urls_path.write_text(new_content)
    print("  + servir les medias en dev ajoute a urls.py")
else:
    print("  = deja configure")
PYEOF

# =============================================================================
echo ""
echo "=============================================="
echo "UPLOAD DE PHOTOS INSTALLE."
echo "=============================================="
echo ""
echo "Test : un script de test te sera fourni separement."
echo ""
echo "Redemarre le serveur :"
echo "  python manage.py runserver"
echo ""
