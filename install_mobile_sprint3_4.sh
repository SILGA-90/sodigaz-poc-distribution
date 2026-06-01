#!/bin/bash
# =============================================================================
# Sprint 3.4 du mobile : geolocalisation
#   - expo-location : capture de la position GPS reelle a la saisie
#   - l'operation et ses photos sont geotaguees avec la vraie position
#   - bouton "Itineraire" : ouvre la navigation externe vers le PLV
# Usage : depuis ~/sodigaz_poc, bash install_mobile_sprint3_4.sh
# =============================================================================

set -e

if [ ! -f "manage.py" ]; then
    echo "ERREUR : execute depuis ~/sodigaz_poc"
    exit 1
fi

cd mobile

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20 > /dev/null 2>&1 || true

echo "=== Installation d'expo-location ==="
npx expo install expo-location

echo ""
echo "=== Creation du service de localisation ==="

mkdir -p src/services

cat > src/services/locationService.ts << 'TSEOF'
/**
 * Service de localisation GPS.
 *
 * Capture ponctuelle de la position au moment d'une saisie d'operation,
 * conformement au choix d'architecture : pas de tracking continu (batterie,
 * doublon avec le systeme de geolocalisation vehicule existant), mais des
 * operations geolocalisees et horodatees dont on deduit l'avancement.
 */
import * as Location from 'expo-location';

export interface Position {
  latitude: number;
  longitude: number;
  precision: number | null; // precision horizontale en metres
}

/**
 * Demande la permission et retourne la position courante.
 * Retourne null si la permission est refusee ou la position indisponible.
 */
export async function getCurrentPosition(): Promise<Position | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    return null;
  }

  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      precision: loc.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}
TSEOF

echo "  + locationService.ts cree"

echo ""
echo "=== Regeneration du saisieRepository (ajout latitude/longitude) ==="

cat > src/db/repositories/saisieRepository.ts << 'TSEOF'
/**
 * Repository pour la saisie d'operation.
 * Fournit les donnees du formulaire et enregistre l'operation en local.
 */
import * as Crypto from 'expo-crypto';

import { getDatabase } from '../database';
import { Produit, TypeOperation, SousTypeCollecte, ModePaiement } from '../../types/models';

export interface ProduitSaisie extends Produit {
  quantite_prevue: number | null; // non null si produit prevu (restitution)
}

export interface EtapeInfo {
  uuid: string;
  programme_uuid: string;
  type_programme: 'COLLECTE' | 'RESTITUTION';
  plv_libelle: string;
  client_raison_sociale: string;
  plv_latitude: number;
  plv_longitude: number;
}

/**
 * Infos de l'etape (type de programme parent, PLV et ses coordonnees).
 */
export async function getEtapeInfo(etapeId: number): Promise<EtapeInfo | null> {
  const db = await getDatabase();
  return db.getFirstAsync<EtapeInfo>(
    `SELECT
        e.uuid AS uuid,
        pr.uuid AS programme_uuid,
        pr.type_programme AS type_programme,
        p.libelle AS plv_libelle,
        c.raison_sociale AS client_raison_sociale,
        p.latitude AS plv_latitude,
        p.longitude AS plv_longitude
     FROM etape e
     JOIN programme pr ON pr.id = e.programme_id
     JOIN plv p ON p.id = e.plv_id
     JOIN client c ON c.id = p.client_id
     WHERE e.id = ?;`,
    [etapeId],
  );
}

/**
 * Produits saisissables :
 *   - RESTITUTION : produits prevus (lignes_programme) avec quantite prevue.
 *   - COLLECTE : tous les produits actifs, quantite_prevue = null.
 */
export async function getProduitsSaisissables(
  etapeId: number,
  typeProgramme: 'COLLECTE' | 'RESTITUTION',
): Promise<ProduitSaisie[]> {
  const db = await getDatabase();

  if (typeProgramme === 'RESTITUTION') {
    return db.getAllAsync<ProduitSaisie>(
      `SELECT
          pr.*,
          lp.quantite_prevue AS quantite_prevue
       FROM ligne_programme lp
       JOIN produit pr ON pr.id = lp.produit_id
       WHERE lp.etape_id = ? AND lp.is_deleted = 0
       ORDER BY pr.libelle;`,
      [etapeId],
    );
  }

  return db.getAllAsync<ProduitSaisie>(
    `SELECT *, NULL AS quantite_prevue
     FROM produit
     WHERE actif = 1
     ORDER BY libelle;`,
  );
}

export interface LigneSaisie {
  produit_code_x3: string;
  quantite_realisee: number;
  montant_ligne: number;
}

export interface OperationSaisie {
  etape_uuid: string;
  type_operation: TypeOperation;
  sous_type: SousTypeCollecte;
  mode_paiement: ModePaiement;
  montant_total: number;
  montant_encaisse: number;
  est_encaissee: boolean;
  latitude?: number | null;
  longitude?: number | null;
  commentaire: string;
  signature_livreur?: string;
  signature_client?: string;
  nom_signataire_client?: string;
  lignes: LigneSaisie[];
}

/**
 * Operation PENDING existante pour cette etape (pour edition) ?
 */
export async function getOperationPendingPourEtape(
  etapeUuid: string,
): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ uuid: string }>(
    `SELECT uuid FROM operation
     WHERE etape_uuid = ? AND sync_status = 'PENDING' AND is_deleted = 0
     LIMIT 1;`,
    [etapeUuid],
  );
  return row?.uuid ?? null;
}

/**
 * Enregistre une operation en local (PENDING).
 * Si une operation PENDING existe deja pour l'etape, on la met a jour
 * (pas de duplication). Marque l'etape comme VISITEE.
 */
export async function enregistrerOperation(data: OperationSaisie): Promise<string> {
  const db = await getDatabase();
  const ts = Date.now();
  const nowIso = new Date().toISOString();
  const lat = data.latitude ?? null;
  const lon = data.longitude ?? null;

  const existant = await getOperationPendingPourEtape(data.etape_uuid);
  const opUuid = existant ?? Crypto.randomUUID();

  await db.withTransactionAsync(async () => {
    if (existant) {
      await db.runAsync('DELETE FROM ligne_operation WHERE operation_uuid = ?;', [opUuid]);
      await db.runAsync(
        `UPDATE operation SET
           type_operation = ?, sous_type = ?, mode_paiement = ?,
           latitude = ?, longitude = ?,
           montant_total = ?, montant_encaisse = ?, est_encaissee = ?,
           signature_livreur = ?, signature_client = ?, nom_signataire_client = ?,
           commentaire = ?, date_heure = ?, last_modified = ?
         WHERE uuid = ?;`,
        [
          data.type_operation, data.sous_type ?? null, data.mode_paiement ?? null,
          lat, lon,
          data.montant_total, data.montant_encaisse, data.est_encaissee ? 1 : 0,
          data.signature_livreur ?? '', data.signature_client ?? '',
          data.nom_signataire_client ?? '',
          data.commentaire, nowIso, ts, opUuid,
        ],
      );
    } else {
      await db.runAsync(
        `INSERT INTO operation
         (uuid, etape_uuid, type_operation, sous_type, date_heure,
          latitude, longitude, mode_paiement, montant_total, montant_encaisse,
          est_encaissee, signature_livreur, signature_client, nom_signataire_client,
          commentaire, sync_status, last_modified, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0);`,
        [
          opUuid, data.etape_uuid, data.type_operation, data.sous_type ?? null, nowIso,
          lat, lon,
          data.mode_paiement ?? null, data.montant_total, data.montant_encaisse,
          data.est_encaissee ? 1 : 0,
          data.signature_livreur ?? '', data.signature_client ?? '',
          data.nom_signataire_client ?? '', data.commentaire, ts,
        ],
      );
    }

    for (const ligne of data.lignes) {
      if (ligne.quantite_realisee <= 0) continue;
      await db.runAsync(
        `INSERT INTO ligne_operation
         (uuid, operation_uuid, produit_code_x3, quantite_realisee,
          quantite_collectee_vide, quantite_consignee, quantite_deconsignee,
          montant_ligne, sync_status, last_modified, is_deleted)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, 'PENDING', ?, 0);`,
        [Crypto.randomUUID(), opUuid, ligne.produit_code_x3,
         ligne.quantite_realisee, ligne.montant_ligne, ts],
      );
    }

    await db.runAsync(
      `UPDATE etape SET statut_visite = 'VISITEE', last_modified = ?
       WHERE uuid = ?;`,
      [ts, data.etape_uuid],
    );
  });

  return opUuid;
}
TSEOF

echo "  + saisieRepository.ts regenere (avec latitude/longitude + coords PLV)"

echo ""
echo "=== Integration dans SaisieOperationScreen (avec verification) ==="

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

# 1. import Linking
rep(
    "  Alert,\n  ScrollView,",
    "  Alert,\n  Linking,\n  ScrollView,",
    "import Linking",
)

# 2. import locationService
rep(
    "import { ajouterPhotoOperation } from '../db/repositories/photoRepository';",
    "import { ajouterPhotoOperation } from '../db/repositories/photoRepository';\n"
    "import { getCurrentPosition } from '../services/locationService';",
    "import locationService",
)

# 3. states GPS
rep(
    "  const [photos, setPhotos] = useState<PhotoEnAttente[]>([]);",
    "  const [photos, setPhotos] = useState<PhotoEnAttente[]>([]);\n"
    "  const [gpsLat, setGpsLat] = useState<number | null>(null);\n"
    "  const [gpsLon, setGpsLon] = useState<number | null>(null);\n"
    "  const [gpsStatus, setGpsStatus] = useState<'en cours' | 'ok' | 'indisponible'>('en cours');",
    "states GPS",
)

# 4. useEffect de capture GPS apres le useEffect existant
rep(
    "  }, [etapeId, navigation]);",
    "  }, [etapeId, navigation]);\n\n"
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
    "useEffect capture GPS",
)

# 5. passer lat/lon a enregistrerOperation
rep(
    "        est_encaissee: estEncaissee,\n"
    "        commentaire,\n"
    "        signature_livreur: signatureLivreur,",
    "        est_encaissee: estEncaissee,\n"
    "        latitude: gpsLat,\n"
    "        longitude: gpsLon,\n"
    "        commentaire,\n"
    "        signature_livreur: signatureLivreur,",
    "lat/lon dans enregistrerOperation",
)

# 6. geotag des photos
rep(
    "          opUuid, ph.uri, ph.type_photo, ph.tailleOctets, null, null,",
    "          opUuid, ph.uri, ph.type_photo, ph.tailleOctets, gpsLat, gpsLon,",
    "geotag photos",
)

# 7. bouton Itineraire + statut GPS dans le header
rep(
    "          <Text style={styles.clientName}>{etapeInfo.client_raison_sociale}</Text>\n"
    "        </View>\n"
    "      )}",
    "          <Text style={styles.clientName}>{etapeInfo.client_raison_sociale}</Text>\n"
    "          <View style={styles.headerRow}>\n"
    "            <Text style={styles.gpsStatus}>Position GPS : {gpsStatus}</Text>\n"
    "            <TouchableOpacity\n"
    "              style={styles.itineraireBtn}\n"
    "              onPress={() => {\n"
    "                const url = `https://www.google.com/maps/dir/?api=1&destination=${etapeInfo.plv_latitude},${etapeInfo.plv_longitude}`;\n"
    "                Linking.openURL(url).catch(() => Alert.alert('Erreur', 'Impossible d\\'ouvrir la navigation.'));\n"
    "              }}\n"
    "            >\n"
    "              <Text style={styles.itineraireText}>Itineraire</Text>\n"
    "            </TouchableOpacity>\n"
    "          </View>\n"
    "        </View>\n"
    "      )}",
    "header itineraire + statut GPS",
)

# 8. styles
rep(
    "  saveDisabled: { opacity: 0.6 },",
    "  saveDisabled: { opacity: 0.6 },\n"
    "  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },\n"
    "  gpsStatus: { color: '#cbe2ff', fontSize: 12 },\n"
    "  itineraireBtn: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },\n"
    "  itineraireText: { color: '#0d6efd', fontWeight: '700', fontSize: 12 },",
    "styles GPS/itineraire",
)

p.write_text(c)
print("  -> SaisieOperationScreen.tsx mis a jour")
PYEOF

echo ""
echo "=== Declaration des permissions de localisation (app.json) ==="

python3 << 'PYEOF'
import json
from pathlib import Path

app_json = Path("app.json")
data = json.loads(app_json.read_text())
expo = data.setdefault("expo", {})

plugins = expo.setdefault("plugins", [])
has_location = any(
    (isinstance(pl, str) and pl == "expo-location") or
    (isinstance(pl, list) and pl and pl[0] == "expo-location")
    for pl in plugins
)
if not has_location:
    plugins.append([
        "expo-location",
        {"locationWhenInUsePermission": "L'application utilise votre position pour geolocaliser les operations de livraison."},
    ])
    print("  + plugin expo-location ajoute a app.json")
else:
    print("  = plugin expo-location deja present")

app_json.write_text(json.dumps(data, indent=2, ensure_ascii=False))
PYEOF

cd ..

echo ""
echo "=============================================="
echo "SPRINT 3.4 - GEOLOCALISATION TERMINEE."
echo "=============================================="
echo ""
echo "Test :"
echo "  1. Recharge l'app : npx expo start --clear puis reload."
echo "  2. Ouvre une etape. Au chargement, Expo Go demande la permission"
echo "     de localisation (accepte). L'en-tete affiche 'Position GPS : ok'."
echo "  3. Le bouton 'Itineraire' ouvre Google Maps vers le PLV."
echo "  4. Saisis une operation, enregistre, synchronise."
echo "  5. Sur la supervision web (carte du dashboard), le marqueur vert"
echo "     de l'operation apparait a TA position reelle."
echo ""
echo "Note : si la permission est refusee ou le GPS indisponible (interieur),"
echo "le statut affiche 'indisponible' et l'operation est enregistree sans"
echo "coordonnees - c'est gere proprement."
echo ""
