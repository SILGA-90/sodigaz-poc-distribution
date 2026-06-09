---
name: design-sodigaz
description: Système de design et règles d'interface pour le POC SODIGAZ (application de distribution de gaz). À utiliser SYSTÉMATIQUEMENT dès que tu crées, modifies ou améliores une interface, que ce soit l'app mobile (Expo / React Native / TypeScript, StyleSheet) ou la supervision web (Django Templates, Bootstrap 5, Leaflet). Déclenche ce skill pour TOUT travail visuel : nouvel écran, nouveau composant, refonte de style, choix de couleurs, typographie, mise en page, icônes, ou gestion des états (chargement, vide, erreur, hors-ligne). Il garantit un rendu soigné, cohérent entre mobile et web, fidèle à la charte SODIGAZ, et adapté à un usage terrain (plein soleil, doigts, gants). Utilise-le même quand l'utilisateur demande juste de « rendre plus joli » ou « améliorer le design » sans plus de précision.
---

# Design — POC SODIGAZ

## Philosophie

Ce n'est pas un site vitrine, c'est une **application opérationnelle de terrain**.
La clarté et la cohérence priment toujours sur l'effet décoratif. Mais « sobre »
ne veut pas dire « négligé » : l'objectif est un rendu net, professionnel, aux
couleurs de SODIGAZ, jamais un Bootstrap brut ni un empilement de styles en ligne
improvisés écran par écran.

Deux utilisateurs, deux contextes :
- **Le livreur** (mobile) : en extérieur, souvent en plein soleil, manipule le
  téléphone avec les doigts, parfois avec des gants, dans l'urgence. Il lui faut
  du gros, du contrasté, des parcours courts, des cibles tactiles généreuses.
- **Le superviseur** (web) : au bureau, sur grand écran. Il lui faut de la
  densité d'information lisible, des tableaux, une carte, des indicateurs clairs.

Règle d'or : **un même système de design alimente les deux surfaces.** Un statut
« Visitée » a la même couleur et le même mot sur mobile et sur le web.

## Avant de coder un écran (processus)

1. **Réutilise les tokens** (couleurs, espacements, typo) ci-dessous. Ne pose
   jamais une valeur hex ou une taille « en dur » dispersée dans un composant.
2. **Liste les états** que l'écran doit gérer (voir « États obligatoires »)
   avant d'écrire le rendu nominal.
3. **Choisis des composants réutilisables** plutôt que de re-styler à la main.
   Si un composant n'existe pas encore, crée-le dans le dossier partagé.
4. Code, puis **relis-toi** : un écran qui ne ressemble pas aux autres est un
   bug de cohérence, pas une variation créative.

## Couleur de marque SODIGAZ (officielle)

Ces couleurs sont tirées du **logo officiel SODIGAZ APC** (globe stylisé +
flamme ; texte « Sodigaz » bleu ; mention « APC » et slogan « Le gaz plus proche
de vous » en orange). Elles sont LA référence de marque et remplacent le bleu
Bootstrap générique (`#0d6efd`) utilisé aujourd'hui dans le code.

```
--brand-blue      #079BD9   (bleu Sodigaz : couleur primaire, entêtes, marque)
--brand-blue-dark #0670A0   (états pressés, ombrages du bleu)
--brand-orange    #EE7202   (orange APC : action principale / accent fort)
--brand-amber     #FAB848   (ambre de la flamme : dégradés, surbrillances)
```

Le logo combine un globe bleu et une flamme en dégradé ambre→orange. Réutilise
ce **dégradé flamme** (`#FAB848` → `#EE7202`) comme signature graphique discrète
(bouton d'action principale, accent d'entête, écran de connexion), avec
parcimonie : c'est l'élément de marque mémorable, pas une décoration à répéter
partout.

Logos disponibles : `logo.png` (symbole seul, fond transparent — icône d'app,
favicon, petit format) et `logo_name.png` (logo complet avec nom — entêtes,
écran de connexion). À placer dans `mobile/assets/` et `supervision/static/img/`.

## Tokens — source unique de vérité

Ces valeurs doivent exister à UN seul endroit par surface, et être importées
partout ailleurs.

### Couleurs

```
Marque
  --primary          #079BD9   (bleu Sodigaz)
  --primary-dark     #0670A0
  --primary-light    #E3F3FB   (fonds de sélection, surbrillances douces)
  --accent           #EE7202   (orange APC : action principale, focus, énergie)
  --accent-amber     #FAB848   (ambre flamme : dégradés)

Sémantique (conservées depuis l'existant Bootstrap)
  --success          #198754   sur fond clair #D1E7DD / texte #0F5132
  --danger           #DC3545   sur fond clair #F8D7DA / texte #842029
  --warning          #FFC107   sur fond clair #FFF3CD / texte #664D03
  --info             #079BD9   sur fond clair #E3F3FB / texte #0670A0

Neutres
  --text             #1F2933   (texte principal)
  --text-muted       #5B6770   (texte secondaire — éviter plus clair en plein soleil)
  --border           #DDE2E6
  --surface          #FFFFFF   (cartes)
  --bg               #F2F4F6   (fond d'écran)
```

Note : la couleur `--info` reprend volontairement le bleu de marque (cohérence),
et l'orange `--accent` sert d'action principale — c'est l'orange du slogan, il
attire l'œil et contraste fort avec le bleu, idéal pour le bouton « le plus
important » d'un écran.

Règle plein soleil : pour une information **importante**, ne descends jamais
sous `--text-muted` en clarté. Le gris très clair sur blanc devient illisible
dehors.

### Typographie

N'embarque aucune police distante (risque hors-ligne / Expo Go) : utilise la
police système (San Francisco sur iOS, Roboto sur Android, pile système sur web).
Échelle commune :

```
display   28 / 700   (titres d'écran web, gros chiffres KPI)
title     20 / 700   (titre d'écran mobile, entête de carte)
subtitle  16 / 600
body      16 / 400   (taille minimale du corps — ne pas descendre en dessous sur mobile)
caption   13 / 500   (métadonnées, libellés de badge)
mono      13          (coordonnées GPS, numéros techniques)
```

### Espacement, rayons, ombres

```
espacement   échelle de 4 : 4, 8, 12, 16, 24, 32
rayon        sm 8 · md 12 · pill 999
ombre        carte : ombre douce et basse (pas d'ombre dure ni colorée)
```

### Cibles tactiles (mobile, non négociable)

Toute zone tappable fait **au minimum 48 × 48 points**. Espace les actions d'au
moins 8 points pour éviter les appuis accidentels avec des gants. Les boutons
d'action principale occupent toute la largeur utile, avec un texte d'au moins 16.

## États obligatoires

Cette application est **offline-first** : l'état du réseau et de la synchronisation
n'est jamais un détail. Tout écran qui affiche ou produit des données gère
explicitement quatre états, en plus du nominal :

1. **Synchronisation / hors-ligne** — un indicateur de connectivité et d'état de
   sync est visible en permanence (ex. bandeau ou pastille : « Hors ligne — 3
   opérations en attente »). L'utilisateur doit toujours savoir si ses données
   sont remontées ou non. C'est l'élément le plus important de l'UI.
2. **Chargement** — spinner ou squelette, jamais un écran blanc figé.
3. **Vide** — un écran vide est une invitation à agir, pas une page morte :
   explique pourquoi c'est vide et quoi faire (« Aucune étape — synchronise pour
   charger ton programme du jour »).
4. **Erreur** — dis ce qui s'est passé et comment le corriger, dans la voix de
   l'interface, sans jargon technique et sans s'excuser.

Code couleur des statuts (mobile ET web, identiques) :
- À visiter → `--warning` / fond `#FFF3CD`
- Visitée → `--success` / fond `#D1E7DD`
- Échec → `--danger` / fond `#F8D7DA`
- En attente de sync → `--info` (bleu marque) ; Synchronisé → `--success`.

## Composants réutilisables

Arrête de styler chaque écran à la main. Crée et réutilise des composants.

### Mobile (`mobile/src/`)

- Centralise les tokens dans `src/theme/` (ex. `theme.ts` exportant `colors`,
  `spacing`, `typography`, `radius`). Tous les `StyleSheet.create` lisent ces
  constantes ; aucune valeur hex en dur ailleurs.
- Crée des composants atomiques dans `src/components/` : `Button` (variantes
  primaire bleu / accent orange / danger), `Card`, `StatusBadge`,
  `ScreenContainer` (gère le fond, les marges, le bandeau de sync), `StateView`
  (chargement / vide / erreur factorisés).
- Privilégie `StyleSheet.create` ; n'ajoute pas de bibliothèque UI lourde
  (risque de casser Expo Go — voir garde-fous).

### Web (`supervision/templates/`)

- Surcharge les **variables Bootstrap** (`--bs-primary` vers `--primary`, soit
  le bleu Sodigaz) plutôt que d'empiler des `!important`. C'est ce qui retire
  l'aspect « Bootstrap par défaut ».
- Un `base.html` cohérent avec le logo en entête (`logo_name.png`), navigation,
  pied. Les cartes KPI, badges et tableaux partagent les mêmes classes.
- Les badges de statut web réutilisent exactement le code couleur ci-dessus.

### Carte Leaflet (web)

- Fond de carte sobre (tuiles claires), pas de style criard qui noie les
  marqueurs.
- Marqueurs colorés selon le statut de l'étape (même code couleur).
- Popups lisibles : nom du PLV en titre, client en sous-titre, statut en badge.

## Écriture des libellés (copy)

Les mots sont du matériau de design, pas de la décoration.
- **Voix active, impératif clair.** Un bouton dit ce qu'il fait : « Clôturer le
  programme », pas « Validation ». L'action garde le même nom du début à la fin
  (le bouton « Synchroniser » produit le message « Synchronisé »).
- **Nomme les choses du point de vue du livreur**, pas du système : « opérations
  en attente », pas « entités PENDING ».
- **Erreurs utiles** : « Synchronisation impossible — réessaie quand tu auras du
  réseau », pas « Erreur 500 ».
- Français, casse de phrase (pas de TOUT EN MAJUSCULES sauf sigles), pas de
  remplissage. Le slogan de marque est « Le gaz plus proche de vous ».

## Garde-fous (cohérents avec CLAUDE.md)

- **Ne réintroduis pas** ce qui a été écarté : carte embarquée sur mobile,
  WatermelonDB, tracking GPS continu.
- **N'ajoute pas de dépendance UI lourde** sur le mobile sans raison forte :
  beaucoup de bibliothèques de composants exigent un build natif et cassent le
  test via Expo Go. En cas de doute, fais-le en `StyleSheet` maison.
- **Pas de police custom distante** : reste sur la pile système (contrainte
  hors-ligne).
- Un changement de design ne doit jamais modifier la logique métier ou de
  synchronisation. Si un écran a besoin d'une donnée qu'il n'a pas, signale-le,
  ne bricole pas le modèle.
- Améliore par **petites passes vérifiables**, écran par écran ou composant par
  composant, jamais une refonte massive d'un seul coup.

## Définition de « terminé » pour un écran

- Lit ses couleurs et tailles depuis les tokens (zéro valeur en dur).
- Utilise le bleu Sodigaz comme primaire et l'orange APC pour l'action principale.
- Gère les quatre états (sync/hors-ligne, chargement, vide, erreur).
- Cibles tactiles ≥ 48, corps de texte ≥ 16 (mobile).
- Cohérent visuellement et verbalement avec les écrans voisins.
- Contraste suffisant pour une lecture en plein soleil.
