#!/bin/bash
# =============================================================================
# reconfig-reseau.sh
# Met a jour la config reseau cote Ubuntu/WSL apres un changement de Wi-Fi :
#   - REACT_NATIVE_PACKAGER_HOSTNAME dans ~/.bashrc
#   - EXPO_PUBLIC_API_URL dans ~/sodigaz_poc/mobile/.env
#
# Usage :
#   bash reconfig-reseau.sh <IP_WINDOWS_WIFI>
# Exemple :
#   bash reconfig-reseau.sh 192.168.1.55
#
# L'IP a passer est celle affichee par le script PowerShell (IP Windows Wi-Fi).
# =============================================================================

set -e

IP_WIN="$1"

if [ -z "$IP_WIN" ]; then
    echo "ERREUR : passe l'IP Windows Wi-Fi en argument."
    echo "Usage : bash reconfig-reseau.sh <IP_WINDOWS_WIFI>"
    echo "Exemple : bash reconfig-reseau.sh 192.168.1.55"
    echo ""
    echo "Cette IP est affichee a la fin du script PowerShell reconfig-reseau.ps1,"
    echo "ou via 'ipconfig' sous Windows (carte Wi-Fi, Adresse IPv4)."
    exit 1
fi

# Validation basique du format IP
if ! [[ "$IP_WIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERREUR : '$IP_WIN' n'a pas l'air d'une adresse IP valide."
    exit 1
fi

echo ""
echo "=== Reconfiguration cote Ubuntu avec IP Windows = $IP_WIN ==="
echo ""

# --- 1. Mettre a jour REACT_NATIVE_PACKAGER_HOSTNAME dans ~/.bashrc ---
BASHRC="$HOME/.bashrc"
LIGNE="export REACT_NATIVE_PACKAGER_HOSTNAME=$IP_WIN"

if grep -q "REACT_NATIVE_PACKAGER_HOSTNAME" "$BASHRC"; then
    # Remplacer la ligne existante
    sed -i "s|export REACT_NATIVE_PACKAGER_HOSTNAME=.*|$LIGNE|" "$BASHRC"
    echo "  + ~/.bashrc mis a jour : $LIGNE"
else
    # Ajouter la ligne
    echo "$LIGNE" >> "$BASHRC"
    echo "  + ligne ajoutee a ~/.bashrc : $LIGNE"
fi

# --- 2. Mettre a jour le .env du mobile ---
ENV_FILE="$HOME/sodigaz_poc/mobile/.env"
NOUVELLE_URL="EXPO_PUBLIC_API_URL=http://$IP_WIN:8000"

if [ -f "$ENV_FILE" ]; then
    if grep -q "EXPO_PUBLIC_API_URL" "$ENV_FILE"; then
        sed -i "s|EXPO_PUBLIC_API_URL=.*|$NOUVELLE_URL|" "$ENV_FILE"
        echo "  + mobile/.env mis a jour : $NOUVELLE_URL"
    else
        echo "$NOUVELLE_URL" >> "$ENV_FILE"
        echo "  + ligne ajoutee a mobile/.env : $NOUVELLE_URL"
    fi
else
    echo "$NOUVELLE_URL" > "$ENV_FILE"
    echo "  + mobile/.env cree : $NOUVELLE_URL"
fi

# --- 3. Recharger .bashrc dans le shell courant ---
export REACT_NATIVE_PACKAGER_HOSTNAME=$IP_WIN

echo ""
echo "=== Termine ==="
echo ""
echo "IMPORTANT : la variable est exportee pour CE terminal."
echo "Pour les autres terminaux deja ouverts, fais 'source ~/.bashrc'"
echo "ou ouvre un nouveau terminal."
echo ""
echo "Tu peux maintenant relancer :"
echo "  Terminal 1 : cd ~/sodigaz_poc && source venv/bin/activate && python manage.py runserver 0.0.0.0:8000"
echo "  Terminal 2 : cd ~/sodigaz_poc/mobile && npx expo start --clear"
echo ""
