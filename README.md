# Prospect Hunter – nouveautés de la Somme

Chaque lundi matin, GitHub Actions ([`.github/workflows/hebdo.yml`](.github/workflows/hebdo.yml)) lance
[`scripts/nouveautes.mjs`](scripts/nouveautes.mjs), qui repère dans la Somme (80) :

- les **commerces** apparus dans OpenStreetMap : supérettes, restaurants, stations essence ;
- les **lotissements** : rues apparues dans la Base Adresse Nationale avec au moins 3 numéros.

Le résultat est publié dans [`publie/nouveautes.csv`](publie/nouveautes.csv), que l'application Prospect Hunter
télécharge chaque semaine. Les nouveautés restent publiées un an.

Ce dépôt ne contient que des données publiques. Aucune donnée de prospection n'y est envoyée.

## Format de `publie/nouveautes.csv`

Une ligne par nouveauté, séparateur `;` :

```
type;lat;lon;catégorie;nom;détail;nombre d'adresses;identifiant;code INSEE;apparu le
```

- `commerce` : catégorie `convenience`, `restaurant` ou `fuel` ; détail = marque ; identifiant OpenStreetMap.
- `lotissement` : nom = rue ; détail = commune ; nombre d'adresses ; identifiant = clé de la rue.

## Lancer à la main

Onglet **Actions** › *Nouveautés de la semaine* › **Run workflow**, ou sur un PC : `node scripts/nouveautes.mjs`
(Node 22 ou plus).

## Sources et licences

- Commerces : © les contributeurs d'OpenStreetMap, sous licence
  [ODbL](https://opendatacommons.org/licenses/odbl/). Le fichier publié est une base de données dérivée, sous
  la même licence.
- Adresses : [Base Adresse Nationale](https://adresse.data.gouv.fr), Licence Ouverte 2.0.
- Communes : [API Géo](https://geo.api.gouv.fr), Licence Ouverte 2.0.
