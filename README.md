# Plaque — le jeu de mots des plaques d'immatriculation

Jeu web en HTML/CSS/JS pur, sans dépendance ni build : ouvrez `index.html`
(ou servez le dossier) et jouez.

## Règle commune

Chaque plaque française au format SIV — `PL-123-MT (34)` — porte **deux paires
de lettres**. Il faut taper des mots contenant les deux lettres d'une paire,
**dans l'ordre**, où que ce soit dans le mot :

`PL` → **P**o**L**ogne, **PL**ongeon, **P**a**L**udisme, ex**pL**oser
`MT` → **M**a**T**raque, **M**on**T**agne, i**M**por**T**ant

Les trois chiffres du milieu sont la **cote** de la plaque, ce qu'elle rapporte une
fois lue. Le **numéro de département** rejoint votre collection à chaque plaque lue.

## Les trois modes

| Mode | Boucle |
|---|---|
| **Trafic** | Au volant sur trois voies (deux sur un écran de moins de 560 px, pour garder les plaques lisibles) : chaque voie a sa voiture, qui arrive à son heure (3,5 s d'écart au minimum) et reste 14 s devant vous ; les trois modèles sont toujours différents. Deux mots par voiture, un par paire. Une plaque lue fait **exploser** la voiture ; une plaque ratée la laisse filer, et la voie se réalimente après 3,5 à 5 s. La partie dure 2 minutes, mais chaque mot rallonge la partie de 1 s et la voiture visée de 2 s, et une plaque lue ajoute 2 s de plus (plafond 2 min 15). |
| **Poursuite** | Vue de l'intérieur, au volant — tableau de bord, compteur qui suit la vraie vitesse, votre véhicule de rang en insigne. Vous roulez plus vite que tout le monde : les voitures surgissent à l'horizon et se rapprochent. **Un seul mot**, sur l'une ou l'autre paire, dégomme une plaque (les deux paires dans un mot : ×2). Celles de votre voie sont des menaces à faire sauter avant le capot ; il n'y a pas d'esquive, seulement les mots. Celles des voies voisines vous frôlent : des points à prendre. Trois pare-chocs, la vitesse qui monte, sans fin. *In extremis* ×1,5, dernier pare-chocs ×2, fièvre ×2. |
| **Parking** | Neuf places sur trois rangées, tous les modèles présents, trois couleurs par parking. Les deux mots d'une plaque et la voiture explose ; une autre vient se garer. Chaque place garde la couleur de la dernière voiture pulvérisée : trois places alignées de même couleur (ligne, colonne, diagonale) rapportent +300 (+500 en diagonale) et se remettent à zéro. Deux minutes, que chaque mot rallonge de 1 s (+2 s par plaque lue et par alignement, plafond 2 min 15). |

La saisie n'a pas de bouton : un mot se valide tout seul après une pause de frappe
d'une seconde dès qu'il est dans le dictionnaire et va sur une plaque (Entrée ou espace
valident immédiatement). Sur téléphone, la page se cale sur la hauteur visible,
clavier ouvert compris, et la scène se redimensionne pour que tout reste à l'écran.

Dans les deux modes, n'importe quel mot va sur n'importe quelle plaque affichée.
Le jeu choisit la cible dans cet ordre : la voiture que le joueur a **désignée**
(un clic sur la voiture ou ses jetons), sinon une voiture que le mot achève, sinon
une voiture déjà entamée, sinon la première qui convient — et il nomme la plaque
touchée à chaque mot. Une voiture entamée devient la cible par défaut. Un mot qui
porte les deux paires lit la plaque d'un coup et compte double. Une paire de lettres
n'est jamais tirée deux fois dans la même partie.

### Points

| | |
|---|---|
| mot | 10 pts + 5 par lettre de la 4e à la 7e, puis **+10 par lettre** au-delà ; +3 par lettre entre les deux lettres de la paire (max +15) |
| rareté | **+25** (mot peu courant) ou **+70** (mot rare), à partir de 5 lettres ; un mot rare de 9 lettres ou plus est un *mot d'expert* : ×1,5 |
| les deux paires dans un mot | ×2, et la plaque est lue d'un coup |
| série | ×1 à ×5, +1 par mot — une erreur la remet à ×1 |
| **cote** | les trois chiffres de la plaque : ce qu'elle rapporte une fois lue, de 100 (paires riches) à 900 (paires rares) |
| coupé | ×1,5 sur ses mots et sa cote (une voiture sur huit) |
| voiture dorée | ×3 (une sur vingt-cinq) ; en Parking sa marque au sol est un joker de couleur |
| camion-citerne | (un sur quatorze) quand il explose, ses voisines explosent avec lui, pour la moitié de leur cote |
| **fièvre** | à ×5, dix secondes pendant lesquelles un seul mot suffit à lire une plaque ; puis la série redescend à ×3 |
| **rush** | les vingt dernières secondes, tout compte double, le ciel vire au rouge |

En Trafic, les voitures restent 14 s au départ et 9 s en fin de partie (la rampe), et les
coupés se multiplient passé la première minute. La première voiture (Trafic) et la première
rangée (Parking) ont toujours des paires accessibles.

### Carrière

Chaque point marqué en partie s'ajoute à la **carrière** — les missions en rapportent 400,
un nouveau département 100. Neuf véhicules, du moins au plus prestigieux (citadine,
utilitaire, camping-car, berline, break, 4×4, pick-up, cabriolet, coupé sport), chacun en
**bronze**, **argent** puis **or** : 27 rangs, de la citadine bronze au coupé or, avec des
seuils qui croissent (1 200, 4 000, 8 200 … ≈ 360 000 points). Le véhicule du rang est
affiché à l'accueil dans son métal, avec la progression vers le rang suivant ; la berline,
le pick-up et le coupé débloquent chacun une teinte de carrosserie (violet, chrome, nacré).

Une partie par jour entretient la **série de jours** : chaque jour d'affilée ajoute 10 % aux
points de carrière gagnés, jusqu'à +100 %. Trois **missions par jour**, tirées de la date
donc identiques pour tout le monde, et quinze **badges** transverses (mots rares, plaques,
citernes, alignements, fièvres, parties, départements, assiduité).

Pendant la partie, la pastille sous le score alterne entre le **fantôme du record** (l'écart
au meilleur score *au même instant*) et le **prochain rang** (« Berline argent dans 340 »).
La **difficulté s'adapte** en silence : trois plaques ratées d'affilée et les paires tirées
s'enrichissent ; des plaques lues à la chaîne et elles se raréfient — avec des cotes plus
hautes. À la fin : le score défile, la barre de rang se remplit (confettis si elle franchit
un seuil ou si c'est un record), meilleur mot, voiture la plus chère, plus longue série,
missions, badges, et **ce que vous auriez pu jouer** sur les plaques qui vous ont échappé.
La toute première partie est guidée par quelques bulles.

### Collection

Chaque plaque entièrement lue ajoute son département à la collection (101 au
total, +100 points de carrière par nouveau). Les départements manquants sortent deux
fois plus souvent sur les plaques, et la grille se consulte depuis l'accueil.

## Structure

```
index.html            écrans (accueil / trafic / poursuite / parking / fin / carrière / badges / collection)
css/style.css
js/game.js            moteur : dictionnaire, règle, tirage, carrière, missions, collection, partage
js/traffic.js         mode Trafic : la scène et sa boucle
js/parking.js         mode Parking : la grille 3×3 en flux, les explosions, les marques de couleur
js/pursuit.js         mode Poursuite : la course, les menaces, les pare-chocs
js/dict.js            113 558 mots + rareté, gzip + base64 (395 Ko)
js/pairs.js           344 paires jouables + exemples de mots
js/departements.js    101 départements (nom, chef-lieu, région)
assets/cars/          sprites pré-rendus : 7 silhouettes de jeu × 12 teintes, 9 véhicules de rang × 3 métaux + layout.json
build/build_data.py   régénère dict.js et pairs.js
build/render_cars.py  régénère les sprites de voitures
```

En Parking, `Faire remorquer` évacue la plaque la plus coriace contre 15 s de temps.

### Les voitures des modes Trafic et Parking

Ce sont des **sprites pré-rendus**, pas de la 3D temps réel : à l'exécution le jeu
n'affiche qu'une balise `<img>`, sans filtre ni fusion, ce qui est moins coûteux à
animer qu'un SVG (que le navigateur re-rastérise à chaque échelle). Mesuré à
121 images/s pendant l'éloignement, pire image à 9 ms.

`build/render_cars.py` les calcule par ray marching sur des surfaces implicites
(SDF), avec éclairage GGX, ombres douces, occlusion ambiante et tone mapping ACES.
Les carrosseries sont décrites dans le script : aucun modèle sous licence, aucune
marque reproduite. La géométrie n'est rendue qu'une fois par silhouette ; les
couleurs sont composées ensuite depuis les tampons d'éclairage, donc ajouter une
teinte ne coûte pas un nouveau rendu.

Sept silhouettes — berline, break, citadine, pick-up, utilitaire, coupé sport,
camion-citerne — en douze teintes : huit de base, trois à débloquer par les rangs,
et l'or des voitures dorées. Les sprites ne sont chargés qu'au lancement d'une partie.

```bash
arch -arm64 python3 build/render_cars.py assets/cars              # ~2 min 30, 48 sprites
arch -arm64 python3 build/render_cars.py /tmp/essai coupe rouge   # une silhouette, une teinte
```

Le script écrit aussi `layout.json` : la position de l'emplacement de plaque,
obtenue en projetant sa boîte avec la caméra du rendu. `js/traffic.js` s'en sert
pour poser la plaque HTML au bon endroit — elle reste du texte, donc nette à
toutes les tailles. Après un nouveau rendu, reporter les valeurs dans `PLATE_Y`
et `PLATE_W` en tête de `traffic.js`.

Les lettres suivent la contrainte SIV réelle : ni I, ni O, ni U.
Tout est stocké en local (`localStorage`) : records, collection, réglages.

### Régénérer les données

Le dictionnaire est construit à partir de [Lexique 3.83](http://www.lexique.org)
(formes fléchées + fréquences films/livres), accents et traits d'union retirés,
mots de 3 à 14 lettres. La rareté vient des mêmes fréquences : courant ≥ 3,
peu courant ≥ 0,3, rare en dessous.

```bash
curl -sLO http://www.lexique.org/databases/Lexique383/Lexique383.tsv
python3 build/build_data.py Lexique383.tsv js
```

Le dictionnaire est décompressé au chargement via `DecompressionStream('gzip')`,
ce qui fonctionne aussi en `file://` — aucun serveur n'est nécessaire.

> Les ressources sont référencées avec un `?v=N` dans `index.html` : incrémentez-le
> après une modification de CSS/JS pour contourner le cache du navigateur.
