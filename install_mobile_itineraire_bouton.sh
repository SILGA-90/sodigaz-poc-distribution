#!/usr/bin/env bash
#
# Ajoute le BOUTON "Itineraire" + ses styles dans la liste des etapes de
# ProgrammeScreen.tsx. La fonction ouvrirItineraire(...) et les imports
# Alert/Linking sont DEJA presents : ce script ne touche qu'au JSX + styles.
#
# Sur : sauvegarde horodatee, verification d'ancres avant ecriture,
# idempotent (detecte via 'itineraireBtn'), restauration si echec.
#
set -euo pipefail

echo "=============================================="
echo " Ajout du bouton Itineraire (liste des etapes)"
echo "=============================================="

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
  exit 1
fi
echo "OK : fichier trouve -> $FILE"

BACKUP="${FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$FILE" "$BACKUP"
echo "OK : sauvegarde -> $BACKUP"

set +e
FILE="$FILE" python3 - <<'PYEOF'
import os, sys
path = os.environ["FILE"]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

# Idempotence : le marqueur fiable est le STYLE du bouton, pas la fonction.
if "itineraireBtn" in src:
    print("OK : bouton deja present, rien a faire (idempotent).")
    sys.exit(0)

edits = []

# (A) Badge -> colonne badge + bouton. Le bouton appelle la fonction
#     ouvrirItineraire deja definie en haut du fichier.
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

# (B) Styles
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

erreurs = []
for libelle, old, _ in edits:
    n = src.count(old)
    if n != 1:
        erreurs.append((libelle, n))
if erreurs:
    print("!! ECHEC : ancres introuvables ou ambigues. Rien ecrit. Detail :")
    for libelle, n in erreurs:
        etat = "introuvable" if n == 0 else ("trouvee %d fois" % n)
        print("     - %s : %s" % (libelle, etat))
    sys.exit(2)

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

if [ "$rc" -ne 0 ]; then
  echo "Le fichier n'a pas ete modifie. Restauration par securite."
  cp "$BACKUP" "$FILE"
  echo "Restaure depuis $BACKUP"
  exit "$rc"
fi

echo "=============================================="
echo " TERMINE. Relance Expo en vidant le cache :"
echo "   cd \$(dirname \"$FILE\")/../../.. && npx expo start --clear"
echo " Annuler : cp \"$BACKUP\" \"$FILE\""
echo "=============================================="
