#!/bin/bash
# =============================================================================
# Sprint 3.4bis : geolocalisation a valeur probante
#   - acquisition FRAICHE et active au moment de l'enregistrement
#   - position qualifiee (fiable / degradee / absente) + precision + horodatage
#   - avertissement si position non fiable, mais enregistrement toujours possible
#   - 2 nouvelles colonnes dans operation : gps_precision, gps_horodatage
#     (migration SQLite v2 -> v3) + cote serveur
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint3_4bis.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : execute depuis ~/sodigaz_poc"
    exit 1
fi

echo "=============================================="
echo " PARTIE 1/3 : SERVEUR (champs GPS sur Operation)"
echo "=============================================="

python3 << 'PYEOF'
from pathlib import Path
import re

models = Path("distribution/models.py")
c = models.read_text()

if "gps_precision" not in c:
    # Reperer la classe Operation et y ajouter les champs apres localisation_saisie.
    # On insere apres la ligne contenant localisation_saisie = ...
    pattern = r"(localisation_saisie\s*=\s*[^\n]+\n)"
    m = re.search(pattern, c)
    if m:
        insertion = (
            "    gps_precision = models.FloatField(\n"
            "        null=True, blank=True,\n"
            "        help_text=\"Rayon d'incertitude de la position GPS en metres (valeur probante).\",\n"
            "    )\n"
            "    gps_horodatage = models.DateTimeField(\n"
            "        null=True, blank=True,\n"
            "        help_text=\"Horodatage de l'acquisition GPS au moment de l'enregistrement.\",\n"
            "    )\n"
        )
        c = c[:m.end()] + insertion + c[m.end():]
        models.write_text(c)
        print("  OK : champs gps_precision et gps_horodatage ajoutes au modele Operation")
    else:
        print("  !! ECHEC : champ localisation_saisie introuvable dans Operation.")
        print("     Ajoute manuellement gps_precision (FloatField) et gps_horodatage (DateTimeField).")
else:
    print("  = champs GPS deja presents dans le modele")
PYEOF

echo ""
echo "  -> Generation de la migration Django..."
python manage.py makemigrations distribution || echo "  (makemigrations a echoue ou rien a migrer)"
python manage.py migrate || echo "  (migrate a echoue, verifie manuellement)"

echo ""
echo "  -> Mise a jour du push serveur (sync_api) pour accepter ces champs"

python3 << 'PYEOF'
from pathlib import Path

# push_serializers : ajouter les 2 champs a OperationPushSerializer
push = Path("sync_api/push_serializers.py")
c = push.read_text()
if "gps_precision" not in c:
    # Inserer apres le champ longitude de OperationPushSerializer.
    # On cible la 1ere occurrence de "longitude = serializers.FloatField" dans ce serializer.
    anchor = "    longitude = serializers.FloatField(required=False, allow_null=True)\n"
    idx = c.find(anchor)
    if idx != -1:
        insertion = (
            "    gps_precision = serializers.FloatField(required=False, allow_null=True)\n"
            "    gps_horodatage = serializers.DateTimeField(required=False, allow_null=True)\n"
        )
        end = idx + len(anchor)
        c = c[:end] + insertion + c[end:]
        push.write_text(c)
        print("  OK : OperationPushSerializer accepte gps_precision / gps_horodatage")
    else:
        print("  !! ECHEC : ancre longitude introuvable dans push_serializers.py")
else:
    print("  = push_serializers deja a jour")

# views.py : ecrire ces champs dans update_or_create de l'operation
views = Path("sync_api/views.py")
vc = views.read_text()
if '"gps_precision"' not in vc:
    anchor = '                        "commentaire": d.get("commentaire", ""),\n'
    if anchor in vc:
        insertion = (
            '                        "gps_precision": d.get("gps_precision"),\n'
            '                        "gps_horodatage": d.get("gps_horodatage"),\n'
        )
        vc = vc.replace(anchor, anchor + insertion, 1)
        views.write_text(vc)
        print("  OK : views.py persiste gps_precision / gps_horodatage")
    else:
        print("  !! ECHEC : ancre commentaire introuvable dans views.py")
else:
    print("  = views.py deja a jour")
PYEOF

echo ""
echo "=============================================="
echo " PARTIE 2/3 : MOBILE (service + schema local)"
echo "=============================================="

cd mobile

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20 > /dev/null 2>&1 || true

echo "=== Service de localisation a valeur probante ==="

cat > src/services/locationService.ts << 'TSEOF'
/**
 * Service de localisation GPS a valeur probante.
 *
 * Principe : on acquiert une position FRAICHE et active au moment ou on en a
 * besoin (a l'enregistrement de l'operation), en haute precision, avec timeout.
 * On renvoie une position QUALIFIEE :
 *   - fiable   : acquise, recente, precision <= SEUIL_FIABLE metres
 *   - degradee : acquise mais imprecise (precision > seuil) ou via cache recent
 *   - absente  : aucune position obtenue
 *
 * On expose aussi la precision (rayon d'incertitude) et l'horodatage, qui
 * sont stockes avec l'operation pour documenter la qualite de la preuve.
 */
import * as Location from 'expo-location';

export type QualitePosition = 'fiable' | 'degradee' | 'absente';

export interface PositionQualifiee {
  qualite: QualitePosition;
  latitude: number | null;
  longitude: number | null;
  precision: number | null;   // metres
  horodatage: string | null;  // ISO 8601, instant de l'acquisition GPS
}

const SEUIL_FIABLE_METRES = 50;
const TIMEOUT_MS = 15000;

const POSITION_ABSENTE: PositionQualifiee = {
  qualite: 'absente',
  latitude: null,
  longitude: null,
  precision: null,
  horodatage: null,
};

/**
 * Acquisition fraiche et active de la position, qualifiee.
 * A appeler au moment de l'enregistrement (valeur probante).
 */
export async function acquerirPositionProbante(): Promise<PositionQualifiee> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    console.log('[GPS] Services desactives.');
    return POSITION_ABSENTE;
  }

  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    console.log('[GPS] Permission refusee.');
    return POSITION_ABSENTE;
  }

  // Acquisition fraiche, haute precision, avec timeout via Promise.race.
  try {
    const loc = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);

    if (loc) {
      const precision = loc.coords.accuracy ?? null;
      const qualite: QualitePosition =
        precision != null && precision <= SEUIL_FIABLE_METRES ? 'fiable' : 'degradee';
      console.log('[GPS] Position fraiche :', loc.coords.latitude, loc.coords.longitude, 'precision', precision, '->', qualite);
      return {
        qualite,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        precision,
        horodatage: new Date(loc.timestamp).toISOString(),
      };
    }
    console.log('[GPS] Timeout acquisition fraiche, repli sur derniere position connue.');
  } catch (e) {
    console.log('[GPS] Erreur acquisition fraiche :', e);
  }

  // Repli : derniere position connue tres recente (< 30 s) = degradee.
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 1000 });
    if (last) {
      console.log('[GPS] Repli derniere position connue :', last.coords.latitude, last.coords.longitude);
      return {
        qualite: 'degradee',
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
        precision: last.coords.accuracy ?? null,
        horodatage: new Date(last.timestamp).toISOString(),
      };
    }
  } catch (e) {
    console.log('[GPS] Repli echoue :', e);
  }

  return POSITION_ABSENTE;
}
TSEOF

echo "  + locationService.ts reecrit (acquisition probante)"

echo ""
echo "=== Migration schema local v2 -> v3 (colonnes GPS) ==="

python3 << 'PYEOF'
from pathlib import Path

# schema.ts : version 3 + colonnes dans la creation initiale de operation
schema = Path("src/db/schema.ts")
c = schema.read_text()
c = c.replace("export const SCHEMA_VERSION = 2;", "export const SCHEMA_VERSION = 3;")
if "gps_precision" not in c:
    c = c.replace(
        "  est_encaissee INTEGER DEFAULT 0,\n",
        "  est_encaissee INTEGER DEFAULT 0,\n"
        "  gps_precision REAL,\n"
        "  gps_horodatage TEXT,\n",
        1,  # uniquement dans la table operation (1ere occurrence)
    )
schema.write_text(c)
print("  + schema.ts : version 3 + colonnes gps sur operation")

# database.ts : ajouter la migration v2 -> v3
db = Path("src/db/database.ts")
dc = db.read_text()
if "currentVersion < 3" not in dc:
    anchor = "    await db.execAsync('PRAGMA user_version = 2;');\n  }"
    insertion = (
        "    await db.execAsync('PRAGMA user_version = 2;');\n  }\n\n"
        "  // Migration v2 -> v3 : colonnes GPS a valeur probante sur operation\n"
        "  if (currentVersion < 3) {\n"
        "    await db.execAsync(`\n"
        "      ALTER TABLE operation ADD COLUMN gps_precision REAL;\n"
        "      ALTER TABLE operation ADD COLUMN gps_horodatage TEXT;\n"
        "    `);\n"
        "    await db.execAsync('PRAGMA user_version = 3;');\n"
        "  }"
    )
    dc = dc.replace(anchor, insertion, 1)
    db.write_text(dc)
    print("  + database.ts : migration v2->v3 ajoutee")
else:
    print("  = migration v3 deja presente")
PYEOF

echo ""
echo "=== Mise a jour du type Operation + saisieRepository ==="

python3 << 'PYEOF'
from pathlib import Path

# types/models.ts : ajouter gps_precision / gps_horodatage a Operation
m = Path("src/types/models.ts")
c = m.read_text()
if "gps_precision" not in c:
    c = c.replace(
        "  est_encaissee: number;\n  signature_livreur: string;",
        "  est_encaissee: number;\n  gps_precision: number | null;\n  gps_horodatage: string | null;\n  signature_livreur: string;",
        1,
    )
    m.write_text(c)
    print("  OK : type Operation enrichi")
else:
    print("  = type Operation deja a jour")

# saisieRepository : OperationSaisie + INSERT/UPDATE avec gps
repo = Path("src/db/repositories/saisieRepository.ts")
c = repo.read_text()

if "gps_precision" not in c:
    # interface OperationSaisie : ajouter les champs
    c = c.replace(
        "  latitude?: number | null;\n  longitude?: number | null;\n  commentaire: string;",
        "  latitude?: number | null;\n  longitude?: number | null;\n"
        "  gps_precision?: number | null;\n  gps_horodatage?: string | null;\n"
        "  commentaire: string;",
    )

    # INSERT : colonnes + valeurs
    c = c.replace(
        "          latitude, longitude, mode_paiement, montant_total, montant_encaisse,\n"
        "          est_encaissee, signature_livreur, signature_client, nom_signataire_client,\n"
        "          commentaire, sync_status, last_modified, is_deleted)\n"
        "         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0);`,",
        "          latitude, longitude, gps_precision, gps_horodatage,\n"
        "          mode_paiement, montant_total, montant_encaisse,\n"
        "          est_encaissee, signature_livreur, signature_client, nom_signataire_client,\n"
        "          commentaire, sync_status, last_modified, is_deleted)\n"
        "         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0);`,",
    )
    c = c.replace(
        "          opUuid, data.etape_uuid, data.type_operation, data.sous_type ?? null, nowIso,\n"
        "          lat, lon,\n"
        "          data.mode_paiement ?? null, data.montant_total, data.montant_encaisse,",
        "          opUuid, data.etape_uuid, data.type_operation, data.sous_type ?? null, nowIso,\n"
        "          lat, lon, data.gps_precision ?? null, data.gps_horodatage ?? null,\n"
        "          data.mode_paiement ?? null, data.montant_total, data.montant_encaisse,",
    )

    # UPDATE : set + valeurs
    c = c.replace(
        "           latitude = ?, longitude = ?,\n"
        "           montant_total = ?, montant_encaisse = ?, est_encaissee = ?,",
        "           latitude = ?, longitude = ?, gps_precision = ?, gps_horodatage = ?,\n"
        "           montant_total = ?, montant_encaisse = ?, est_encaissee = ?,",
    )
    c = c.replace(
        "          lat, lon,\n"
        "          data.montant_total, data.montant_encaisse, data.est_encaissee ? 1 : 0,",
        "          lat, lon, data.gps_precision ?? null, data.gps_horodatage ?? null,\n"
        "          data.montant_total, data.montant_encaisse, data.est_encaissee ? 1 : 0,",
    )

    repo.write_text(c)
    print("  OK : saisieRepository gere les champs GPS")
else:
    print("  = saisieRepository deja a jour")
PYEOF

echo ""
echo "=== Mise a jour du push mobile (envoi des champs GPS) ==="

python3 << 'PYEOF'
from pathlib import Path

sync = Path("src/sync/syncService.ts")
c = sync.read_text()
if "gps_precision" not in c:
    c = c.replace(
        "          longitude: o.longitude,\n"
        "          mode_paiement: o.mode_paiement ?? null,",
        "          longitude: o.longitude,\n"
        "          gps_precision: o.gps_precision ?? null,\n"
        "          gps_horodatage: o.gps_horodatage ?? null,\n"
        "          mode_paiement: o.mode_paiement ?? null,",
    )
    sync.write_text(c)
    print("  OK : push mobile envoie gps_precision / gps_horodatage")
else:
    print("  = push mobile deja a jour")
PYEOF

echo ""
echo "=== Capture au moment de l'enregistrement dans SaisieOperationScreen ==="

python3 << 'PYEOF'
from pathlib import Path

p = Path("src/screens/SaisieOperationScreen.tsx")
c = p.read_text()

def rep(old, new, label):
    global c
    if old in c:
        c = c.replace(old, new, 1)
        print(f"  OK : {label}")
    else:
        print(f"  !! ECHEC (motif introuvable) : {label}")

# 1. changer l'import du service
rep(
    "import { getCurrentPosition } from '../services/locationService';",
    "import { acquerirPositionProbante } from '../services/locationService';",
    "import service probant",
)

# 2. remplacer le useEffect de capture a l'ouverture par un simple etat
#    On retire la capture a l'ouverture ; la capture se fait dans handleSave.
rep(
    "  useEffect(() => {\n"
    "    (async () => {\n"
    "      try {\n"
    "        const pos = await getCurrentPosition();\n"
    "        if (pos) {\n"
    "          setGpsLat(pos.latitude);\n"
    "          setGpsLon(pos.longitude);\n"
    "          setGpsStatus('ok');\n"
    "        } else {\n"
    "          setGpsStatus('indisponible');\n"
    "        }\n"
    "      } catch {\n"
    "        setGpsStatus('indisponible');\n"
    "      }\n"
    "    })();\n"
    "  }, []);",
    "  // La position est acquise au moment de l'enregistrement (valeur probante),\n"
    "  // pas a l'ouverture de l'ecran.",
    "suppression capture a l'ouverture",
)

# 3. adapter les states GPS (ajout precision/horodatage, statut initial)
rep(
    "  const [gpsLat, setGpsLat] = useState<number | null>(null);\n"
    "  const [gpsLon, setGpsLon] = useState<number | null>(null);\n"
    "  const [gpsStatus, setGpsStatus] = useState<'en cours' | 'ok' | 'indisponible'>('en cours');",
    "  const [gpsLat, setGpsLat] = useState<number | null>(null);\n"
    "  const [gpsLon, setGpsLon] = useState<number | null>(null);\n"
    "  const [gpsPrecision, setGpsPrecision] = useState<number | null>(null);\n"
    "  const [gpsHorodatage, setGpsHorodatage] = useState<string | null>(null);\n"
    "  const [gpsStatus, setGpsStatus] = useState<'a capturer' | 'fiable' | 'degradee' | 'absente'>('a capturer');",
    "states GPS enrichis",
)

# 4. afficher le statut GPS textuel adapte
rep(
    "            <Text style={styles.gpsStatus}>Position GPS : {gpsStatus}</Text>",
    "            <Text style={styles.gpsStatus}>Position : {gpsStatus}</Text>",
    "libelle statut GPS",
)

# 5. dans handleSave : capturer la position AVANT l'enregistrement + avertir si non fiable
rep(
    "    setSaving(true);\n"
    "    try {\n"
    "      const typeOp = etapeInfo.type_programme === 'COLLECTE' ? 'COLLECTE' : 'RESTITUTION';",
    "    setSaving(true);\n"
    "    try {\n"
    "      // Acquisition de la position au moment de l'enregistrement (valeur probante)\n"
    "      const pos = await acquerirPositionProbante();\n"
    "      setGpsLat(pos.latitude);\n"
    "      setGpsLon(pos.longitude);\n"
    "      setGpsPrecision(pos.precision);\n"
    "      setGpsHorodatage(pos.horodatage);\n"
    "      setGpsStatus(pos.qualite);\n"
    "\n"
    "      if (pos.qualite !== 'fiable') {\n"
    "        const msg = pos.qualite === 'absente'\n"
    "          ? 'Aucune position GPS fiable n\\'a pu etre obtenue. L\\'operation sera enregistree SANS position. Continuer ?'\n"
    "          : `Position GPS peu precise (${pos.precision ? Math.round(pos.precision) + ' m' : 'inconnue'}). Enregistrer quand meme ?`;\n"
    "        const confirme = await new Promise<boolean>((resolve) => {\n"
    "          Alert.alert('Position GPS', msg, [\n"
    "            { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },\n"
    "            { text: 'Enregistrer', onPress: () => resolve(true) },\n"
    "          ]);\n"
    "        });\n"
    "        if (!confirme) { setSaving(false); return; }\n"
    "      }\n"
    "\n"
    "      const typeOp = etapeInfo.type_programme === 'COLLECTE' ? 'COLLECTE' : 'RESTITUTION';",
    "capture probante dans handleSave",
)

# 6. passer precision/horodatage + position fraiche a enregistrerOperation
rep(
    "        est_encaissee: estEncaissee,\n"
    "        latitude: gpsLat,\n"
    "        longitude: gpsLon,\n"
    "        commentaire,",
    "        est_encaissee: estEncaissee,\n"
    "        latitude: pos.latitude,\n"
    "        longitude: pos.longitude,\n"
    "        gps_precision: pos.precision,\n"
    "        gps_horodatage: pos.horodatage,\n"
    "        commentaire,",
    "passage position a enregistrerOperation",
)

# 7. geotag photos avec la position fraiche
rep(
    "          opUuid, ph.uri, ph.type_photo, ph.tailleOctets, gpsLat, gpsLon,",
    "          opUuid, ph.uri, ph.type_photo, ph.tailleOctets, pos.latitude, pos.longitude,",
    "geotag photos avec position fraiche",
)

p.write_text(c)
print("  -> SaisieOperationScreen.tsx mis a jour")
PYEOF

cd ..

echo ""
echo "=============================================="
echo "SPRINT 3.4bis - GEOLOCALISATION PROBANTE."
echo "=============================================="
echo ""
echo "Verifie qu'aucun '!! ECHEC' n'apparait ci-dessus."
echo ""
echo "IMPORTANT : redemarre Django (nouveaux champs + migration) :"
echo "  python manage.py runserver 0.0.0.0:8000"
echo ""
echo "Test :"
echo "  1. Recharge l'app : npx expo start --clear puis reload."
echo "     (La base locale migre en v3 automatiquement.)"
echo "  2. Ouvre une etape, remplis. L'en-tete affiche 'Position : a capturer'."
echo "  3. Appuie sur 'Enregistrer'. LA, l'app acquiert la position fraiche."
echo "     - Si fiable : enregistrement direct."
echo "     - Si degradee/absente : un avertissement te demande de confirmer."
echo "  4. Synchronise. Sur l'admin Django > Operations, tu verras"
echo "     gps_precision et gps_horodatage renseignes."
echo ""
echo "Pour un test 'fiable' : sois dehors, GPS en haute precision, et"
echo "laisse 5-15 s a l'acquisition au moment du clic Enregistrer."
echo ""
