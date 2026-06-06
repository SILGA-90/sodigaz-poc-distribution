#!/usr/bin/env bash
#
# Ajoute un bouton "Itineraire" sur chaque carte d'etape de ProgrammeScreen.tsx.
# Le bouton ouvre l'application de navigation du telephone (Google Maps) vers
# les coordonnees du PLV. Pas de carte embarquee (incompatible Expo Go).
#
# Le script est SUR :
#  - il fait une sauvegarde horodatee avant toute modification ;
#  - il verifie que les 4 points d'ancrage existent AVANT d'ecrire ;
#  - il est idempotent (relancable sans degat : il detecte s'il a deja tourne) ;
#  - si une ancre manque, il n'ecrit RIEN et affiche un !! ECHEC explicite.
#
# Usage : bash install_mobile_itineraire_liste.sh
#
set -euo pipefail

echo "=============================================="
echo " Insertion du bouton Itineraire (ProgrammeScreen.tsx)"
echo "=============================================="

# --- 1. Localiser le fichier ----------------------------------------------
FILE=""
for c in \
  "$PWD/mobile/src/screens/ProgrammeScreen.tsx" \
  "$PWD/src/screens/ProgrammeScreen.tsx" \
  "$HOME/sodigaz_poc/mobile/src/screens/ProgrammeScreen.tsx"
do
  if [ -f "$c" ]; then FILE="$c"; break; fi
done

if [ -z "$FILE" ]; then
  FILE="$(find "${HOME}/sodigaz_poc" -type f -name 'ProgrammeScreen.tsx' \
          -not -path '*/node_modules/*' 2>/dev/null | head -n1 || true)"
fi

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "!! ECHEC : ProgrammeScreen.tsx introuvable."
  echo "   Lance ce script depuis ~/sodigaz_poc (ou ~/sodigaz_poc/mobile)."
  exit 1
fi
echo "OK : fichier trouve -> $FILE"

# --- 2. Sauvegarde ---------------------------------------------------------
BACKUP="${FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$FILE" "$BACKUP"
echo "OK : sauvegarde -> $BACKUP"

# --- 3. Application via Python (remplacements de chaines exactes) ----------
# Le heredoc est quote ('PYEOF') : aucune expansion bash, le code TS passe intact.
set +e
FILE="$FILE" python3 - <<'PYEOF'
import os, sys

path = os.environ["FILE"]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# Deja applique ? -> on ne refait rien.
if "ouvrirItineraire" in src or "itineraireBtn" in src:
    print("OK : modification deja presente, rien a faire (idempotent).")
    sys.exit(0)

edits = []  # (libelle, old, new)

# (1) Imports : ajouter Alert et Linking
edits.append((
    "imports Alert + Linking",
"""import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';""",
"""import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';""",
))

# (2) Fonction ouvrirItineraire, inseree juste avant renderEtape
edits.append((
    "fonction ouvrirItineraire",
"  function renderEtape({ item }: { item: EtapeAvecPlv }): React.ReactElement {",
"""  async function ouvrirItineraire(lat: number, lon: number): Promise<void> {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
    const ok = await Linking.canOpenURL(url);
    if (ok) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Itineraire', "Impossible d'ouvrir l'application de navigation.");
    }
  }

  function renderEtape({ item }: { item: EtapeAvecPlv }): React.ReactElement {""",
))

# (3) Badge de statut -> colonne badge + bouton Itineraire
edits.append((
    "bouton dans la carte d'etape",
"""        <View style={[styles.statutBadge, visite ? styles.visitee : styles.aVisiter]}>
          <Text style={styles.statutText}>{visite ? 'Visitee' : 'A visiter'}</Text>
        </View>""",
"""        <View style={styles.actionsCol}>
          <View style={[styles.statutBadge, visite ? styles.visitee : styles.aVisiter]}>
            <Text style={styles.statutText}>{visite ? 'Visitee' : 'A visiter'}</Text>
          </View>
          <TouchableOpacity
            style={styles.itineraireBtn}
            onPress={(e) => {
              e.stopPropagation();
              ouvrirItineraire(item.plv_latitude, item.plv_longitude);
            }}
          >
            <Text style={styles.itineraireBtnText}>Itineraire</Text>
          </TouchableOpacity>
        </View>""",
))

# (4) Styles
edits.append((
    "styles actionsCol + itineraireBtn",
"  statutText: { fontSize: 11, fontWeight: '700', color: '#333' },",
"""  statutText: { fontSize: 11, fontWeight: '700', color: '#333' },
  actionsCol: { alignItems: 'flex-end' },
  itineraireBtn: {
    marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: '#cfe2ff', borderWidth: 1, borderColor: '#0d6efd',
  },
  itineraireBtnText: { fontSize: 11, fontWeight: '700', color: '#084298' },""",
))

# Verification prealable : chaque ancre doit apparaitre exactement 1 fois.
erreurs = []
for libelle, old, _ in edits:
    n = src.count(old)
    if n != 1:
        erreurs.append((libelle, n))

if erreurs:
    print("!! ECHEC : certaines ancres sont introuvables ou ambigues.")
    print("   Aucune modification ecrite. Detail :")
    for libelle, n in erreurs:
        etat = "introuvable" if n == 0 else ("trouvee %d fois (ambigu)" % n)
        print("     - %s : %s" % (libelle, etat))
    print("   Copie-colle moi l'etat actuel du fichier pour recaler les ancres.")
    sys.exit(2)

# Application sequentielle (les ancres ne se chevauchent pas).
out = src
for _, old, new in edits:
    out = out.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(out)

for libelle, _, _ in edits:
    print("OK : %s" % libelle)
print("OK : fichier mis a jour.")
PYEOF
rc=$?
set -e

# --- 4. Bilan --------------------------------------------------------------
if [ "$rc" -ne 0 ]; then
  echo "----------------------------------------------"
  echo "Le fichier n'a pas ete modifie. Restauration de la sauvegarde par securite."
  cp "$BACKUP" "$FILE"
  echo "Fichier restaure depuis $BACKUP"
  exit "$rc"
fi

echo "=============================================="
echo " TERMINE."
echo " Recharge l'app (touche 'r' dans le terminal Expo)."
echo " Pour annuler, restaure avec :"
echo "   cp \"$BACKUP\" \"$FILE\""
echo "=============================================="
