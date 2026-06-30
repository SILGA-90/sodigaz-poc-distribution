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

## Direction visuelle (anti-générique)

Le piège à éviter absolument : l'interface « générée par IA ». On la reconnaît à
des signes précis — tout en relief mou et ombres douces uniformes, contrastes
faibles, surfaces gris clair qui flottent, coins très arrondis partout, aucune
hiérarchie (tout a le même poids visuel), dégradés violet/rose décoratifs,
emojis en guise d'icônes. Une interface ne paraît PAS générée par IA quand ses
choix répondent visiblement à un contexte d'usage réel, qu'un générateur
générique n'aurait pas connu.

**Position arrêtée sur le néomorphisme.** Le néomorphisme (relief simulé par
ombres douces et faibles contrastes) est SOIT abandonné, SOIT cantonné à un
accent ponctuel — jamais le style dominant de cette application. Deux raisons
qui pointent dans le même sens :
- Il dégrade la lisibilité en plein soleil, qui est la condition d'usage réelle
  du livreur. Un bouton gris clair en relief sur fond gris clair est invisible
  dehors à midi. C'est un défaut fonctionnel, pas une question de goût.
- Appliqué uniformément, c'est précisément ce qui produit l'impression « IA
  générique » : pas de hiérarchie, pas de point d'ancrage pour l'œil.

Si un effet néomorphique est conservé, il l'est uniquement sur des éléments
**non critiques consultés à l'intérieur** (par exemple une carte de statistique
dans la supervision web, regardée au bureau), jamais sur ce que le livreur doit
lire ou toucher sur le terrain.

**La base à privilégier : nette et franche.** Surfaces claires bien séparées par
des bordures fines OU des ombres portées discrètes mais présentes (pas diffuses).
Hiérarchie forte : ce qui est important est visiblement plus grand et plus
contrasté. Couleur de marque en **accent** sur les actions clés, pas étalée en
fond. Contraste assumé sur tout ce qui se lit ou se touche. Cette base n'a pas
de nom de style à la mode — et c'est exactement pour cela qu'elle ne paraît pas
générique.

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

## Micro-interactions et animations

Le mouvement sert le retour d'information, jamais la décoration. Une animation
utile confirme une action ; une animation gratuite ralentit le livreur.

Principes :
- **Retour immédiat au tap.** Tout élément tappable réagit visiblement à la
  pression : légère baisse d'opacité ou de teinte, ou enfoncement de 1 à 2 points.
  Sur mobile, `Pressable` avec un style `pressed`, ou `activeOpacity` autour de
  0.7 sur `TouchableOpacity`. Sur web, un état `:active` et `:hover` net avec
  `cursor: pointer`.
- **Transitions courtes.** 150 à 250 ms, jamais plus. Au-delà, l'interface
  paraît lente sur le terrain. Courbe `ease-out` par défaut.
- **Transitions d'état signifiantes.** Quand un statut change (À visiter →
  Visitée, En attente → Synchronisé), une transition douce de couleur aide
  l'œil à suivre le changement. C'est le seul endroit où l'animation porte du
  sens métier — soigne-la.
- **Indicateur de synchronisation animé.** Pendant une synchro, l'indicateur
  tourne ou pulse discrètement ; à la fin, il se fige sur l'état atteint. C'est
  le retour le plus important de l'app.
- **Respecte `prefers-reduced-motion`** côté web : si l'utilisateur a désactivé
  les animations, réduis-les au minimum.

Contraintes : pas de bibliothèque d'animation lourde qui casserait Expo Go.
L'API `Animated` de React Native et les transitions CSS suffisent à tout ce qui
précède. Pas d'animation en boucle permanente (consomme la batterie sur le
terrain).

## Patterns de composants

Chaque composant a un comportement défini dans TOUS ses états. Un composant qui
n'existe qu'à l'état « normal » est incomplet.

**Bouton** — trois variantes : primaire (bleu Sodigaz, actions courantes),
accent (orange APC, l'action LA plus importante d'un écran, une seule par écran),
danger (rouge, actions destructrices). États obligatoires : normal, pressé
(retour visuel), désactivé (opacité réduite, non tappable), en cours (spinner +
texte « … en cours », bouton non recliquable pour éviter le double envoi —
critique pour la saisie d'opération). Texte ≥ 16, hauteur ≥ 48.

**Carte** (étape, opération) — surface claire, séparation nette du fond (bordure
fine ou ombre basse), zone tappable couvrant toute la carte si elle mène à un
détail. Hiérarchie interne : un élément principal (nom du PLV) nettement plus
fort que les secondaires (client, coordonnées).

**Champ de saisie** — label toujours visible (pas seulement un placeholder qui
disparaît), état focus net (bordure accent), état erreur (bordure danger +
message sous le champ expliquant quoi corriger), clavier adapté au contenu
(`number-pad` pour les quantités). Cible ≥ 48 de haut.

**Badge de statut** — pastille colorée selon le code couleur des statuts, texte
court, jamais seulement une couleur (toujours un mot, pour l'accessibilité et le
plein soleil).

**Indicateur de connectivité / sync** — toujours visible, trois états lisibles
d'un coup d'œil : en ligne / hors ligne / synchronisation en cours, avec le
nombre d'opérations en attente le cas échéant.

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
- Hiérarchie visuelle claire : l'élément important ressort, tout n'a pas le même poids.
- Chaque élément tappable réagit à la pression ; transitions ≤ 250 ms.
- Composants gérés dans tous leurs états (normal, pressé, désactivé, en cours, erreur).
- Aucun signe d'interface « générée par IA » : pas de relief mou uniforme, pas
  de dégradé décoratif gratuit, pas d'emoji en guise d'icône, hiérarchie présente.
