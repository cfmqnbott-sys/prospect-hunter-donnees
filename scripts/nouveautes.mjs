// Nouveautés de la Somme pour l'application Prospect Hunter, publiées chaque lundi par GitHub Actions
// (.github/workflows/hebdo.yml) dans publie/nouveautes.csv :
//  - commerces (supérettes, restaurants, stations essence) apparus dans OpenStreetMap ;
//  - lotissements : rues apparues dans la Base Adresse Nationale avec au moins MIN_LOTISSEMENT_ADRESSES numéros.
//
// L'état d'une semaine à l'autre est gardé dans etat/ (commerces connus, rues connues) et commité avec la
// publication. Si une source est indisponible, sa partie de l'état et de la publication reste celle de la
// semaine précédente ; le script échoue seulement si les deux sources le sont.
//
// Format de publie/nouveautes.csv, une ligne par nouveauté, séparateur « ; » :
//   type;lat;lon;catégorie;nom;détail;nombre d'adresses;identifiant;code INSEE;apparu le
//   - commerce : catégorie convenience|restaurant|fuel, nom, détail = marque, identifiant OSM (n123, w456…)
//   - lotissement : catégorie vide, nom = rue, détail = commune, nombre d'adresses, identifiant = clé de rue
// Données : © les contributeurs d'OpenStreetMap (ODbL) ; Base Adresse Nationale (Licence Ouverte 2.0).
//
// Usage : node scripts/nouveautes.mjs

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip, gunzipSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const DEPARTEMENT = "80";
const USER_AGENT = "ProspectHunter-donnees/1.0 (+https://github.com/cfmqnbott-sys/prospect-hunter-donnees)";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const BAN_URL = `https://adresse.data.gouv.fr/data/ban/adresses/latest/csv/adresses-${DEPARTEMENT}.csv.gz`;
// Une rue nouvelle de moins de numéros est plutôt une maison isolée ou une rue renommée qu'un lotissement
const MIN_LOTISSEMENT_ADRESSES = 3;
// Les nouveautés restent publiées ce nombre de jours (l'application ne signale que les plus récentes)
const PUBLIE_JOURS = 365;
// En dessous, la réponse d'Overpass est sûrement tronquée (la Somme en compte plus d'un millier)
const MIN_COMMERCES = 300;

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const etatCommerces = join(racine, "etat", "commerces.csv");
const etatCommercesCompte = join(racine, "etat", "commerces-compte.txt");
const etatRues = join(racine, "etat", "rues.txt.gz");
const etatLotissements = join(racine, "etat", "lotissements.csv");
const publication = join(racine, "publie", "nouveautes.csv");

const aujourdHui = new Date().toISOString().slice(0, 10);
const limite = new Date(Date.now() - PUBLIE_JOURS * 86400e3).toISOString().slice(0, 10);
const propre = (texte) => (texte ?? "").replace(/[;\r\n]+/g, " ").replace(/\s+/g, " ").trim();

async function fetchOk(url, options) {
  const reponse = await fetch(url, { ...options, headers: { "User-Agent": USER_AGENT, ...options?.headers } });
  if (!reponse.ok) throw new Error(`${url} : HTTP ${reponse.status}`);
  return reponse;
}

function lireLignes(chemin) {
  return existsSync(chemin) ? readFileSync(chemin, "utf8").split("\n").filter(Boolean) : [];
}

// Code INSEE de la commune d'un point (API Géo), pour que l'application ne signale que son secteur
async function codeInsee(lat, lon) {
  try {
    const reponse = await fetchOk(`https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=code&format=json`);
    return (await reponse.json())[0]?.code ?? "";
  } catch {
    return "";
  }
}

// --- Commerces OpenStreetMap ---
// État : id;catégorie;lat;lon;nom;marque;code INSEE;apparu le (vide : déjà connu à l'initialisation)
async function majCommerces() {
  const requete = `
[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="${DEPARTEMENT}"]->.dep;
(
  nwr["shop"="convenience"](area.dep);
  nwr["amenity"="restaurant"](area.dep);
  nwr["amenity"="fuel"](area.dep);
);
out center tags;
`;
  let donnees = null;
  for (let tour = 0; tour < 4 && !donnees; tour++) {
    for (const url of OVERPASS_URLS) {
      try {
        const reponse = await fetchOk(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(requete)}`,
        });
        // Un serveur saturé répond parfois 200 avec une page d'erreur ou un « remark » : seul un JSON complet compte
        const json = await reponse.json();
        if (json.remark) throw new Error(json.remark);
        donnees = json;
        break;
      } catch (e) {
        console.log(`${url} : ${e.message}`);
      }
    }
    if (!donnees) await sleep(60_000 * 2 ** tour);
  }
  if (!donnees) throw new Error("Overpass indisponible");

  const connus = new Map(lireLignes(etatCommerces).map((ligne) => [ligne.split(";")[0], ligne.split(";")]));
  const lignes = [];
  let nouveaux = 0;
  for (const element of donnees.elements) {
    const tags = element.tags ?? {};
    const categorie =
      tags.amenity === "fuel" ? "fuel" :
      tags.amenity === "restaurant" ? "restaurant" :
      tags.shop === "convenience" ? "convenience" : null;
    const centre = element.center ?? element;
    if (!categorie || centre.lat == null || centre.lon == null) continue;
    const id = `${element.type[0]}${element.id}`;
    const lat = centre.lat.toFixed(6);
    const lon = centre.lon.toFixed(6);
    const ancien = connus.get(id);
    let apparu = ancien?.[7] ?? "";
    let insee = ancien?.[6] ?? "";
    if (!ancien) {
      apparu = aujourdHui;
      insee = await codeInsee(lat, lon);
      nouveaux++;
    }
    lignes.push([id, categorie, lat, lon, propre(tags.name), propre(tags.brand), insee, apparu].join(";"));
  }
  // Garde-fou : une réponse tronquée effacerait l'état et ferait passer pour nouveaux les commerces revenus la
  // semaine suivante. Comparaison avec le nombre de la semaine précédente (l'état initial, lui, couvre toute la
  // région et n'a pas de nombre enregistré).
  const precedent = Number(lireLignes(etatCommercesCompte)[0] ?? 0);
  if (lignes.length < Math.max(MIN_COMMERCES, precedent * 0.8)) {
    throw new Error(`Seulement ${lignes.length} commerces reçus (${precedent} la semaine passée) : état conservé`);
  }
  writeFileSync(etatCommerces, lignes.sort().join("\n") + "\n");
  writeFileSync(etatCommercesCompte, `${lignes.length}\n`);
  console.log(`${lignes.length} commerces, ${nouveaux} nouveaux`);
}

// --- Lotissements de la Base Adresse Nationale ---
// État : clés des rues connues (code INSEE|nom sans casse ni accents), et lotissements repérés
// (clé;lat;lon;rue;commune;nombre d'adresses;code INSEE;apparu le)
async function majLotissements() {
  const reponse = await fetchOk(BAN_URL);
  const lignes = createInterface({ input: Readable.fromWeb(reponse.body).pipe(createGunzip()) });
  let colonnes = null;
  const rues = new Map();
  for await (const ligne of lignes) {
    const f = ligne.split(";");
    if (!colonnes) {
      colonnes = Object.fromEntries(f.map((nom, i) => [nom, i]));
      continue;
    }
    const lat = Number(f[colonnes.lat]);
    const lon = Number(f[colonnes.lon]);
    const nom = (f[colonnes.nom_voie] ?? "").trim();
    const insee = f[colonnes.code_insee];
    if (!nom || !insee || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cle = `${insee}|${nom.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()}`;
    let rue = rues.get(cle);
    if (!rue) rues.set(cle, (rue = { nom, commune: (f[colonnes.nom_commune] ?? "").trim(), insee, lat: 0, lon: 0, n: 0 }));
    rue.lat += lat;
    rue.lon += lon;
    rue.n++;
  }
  if (rues.size < 1000) throw new Error(`Seulement ${rues.size} rues lues : état conservé`);

  const lotissements = lireLignes(etatLotissements).filter((ligne) => (ligne.split(";")[7] ?? "") >= limite);
  let nouveaux = 0;
  if (existsSync(etatRues)) {
    const connues = new Set(gunzipSync(readFileSync(etatRues)).toString("utf8").split("\n"));
    for (const [cle, rue] of rues) {
      if (connues.has(cle) || rue.n < MIN_LOTISSEMENT_ADRESSES) continue;
      nouveaux++;
      lotissements.push([
        propre(cle), (rue.lat / rue.n).toFixed(6), (rue.lon / rue.n).toFixed(6),
        propre(rue.nom), propre(rue.commune), rue.n, rue.insee, aujourdHui,
      ].join(";"));
    }
  } else {
    console.log("Pas de rues connues : cette liste sert de référence pour les prochaines semaines");
  }
  writeFileSync(etatLotissements, lotissements.length ? lotissements.join("\n") + "\n" : "");
  writeFileSync(etatRues, gzipSync(Buffer.from([...rues.keys()].sort().join("\n"), "utf8"), { level: 9 }));
  console.log(`${rues.size} rues, ${nouveaux} nouveaux lotissements`);
}

// --- Publication ---
function publier() {
  const sortie = [];
  for (const ligne of lireLignes(etatCommerces)) {
    const [id, categorie, lat, lon, nom, marque, insee, apparu] = ligne.split(";");
    if (apparu && apparu >= limite) {
      sortie.push(["commerce", lat, lon, categorie, nom, marque, "", id, insee, apparu].join(";"));
    }
  }
  for (const ligne of lireLignes(etatLotissements)) {
    const [cle, lat, lon, rue, commune, n, insee, apparu] = ligne.split(";");
    sortie.push(["lotissement", lat, lon, "", rue, commune, n, cle, insee, apparu].join(";"));
  }
  mkdirSync(dirname(publication), { recursive: true });
  writeFileSync(publication, sortie.length ? sortie.join("\n") + "\n" : "");
  console.log(`${sortie.length} nouveautés publiées -> publie/nouveautes.csv`);
}

const echecs = [];
for (const [nom, maj] of [["commerces", majCommerces], ["lotissements", majLotissements]]) {
  try {
    await maj();
  } catch (e) {
    console.error(`Mise à jour des ${nom} impossible : ${e.message}`);
    echecs.push(nom);
  }
}
publier();
if (echecs.length === 2) process.exit(1);
