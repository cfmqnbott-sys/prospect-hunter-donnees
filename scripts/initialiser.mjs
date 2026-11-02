// Initialise etat/ à partir des données déjà intégrées à l'application (une seule fois, avant la première
// mise à jour) : la première semaine signale ainsi ce qui est apparu depuis leur génération, au lieu de servir
// seulement de référence.
//
// Usage : node scripts/initialiser.mjs <commerces_region.csv de l'application> <ban-rues-region.txt.gz>
//   commerces_region.csv : lat;lon;catégorie;nom;marque;id OSM;apparu le
//   ban-rues-region.txt.gz : clés « code INSEE|nom de rue » de la région

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const DEPARTEMENT = "80";
const [commercesApp, ruesApp] = process.argv.slice(2);
if (!commercesApp || !ruesApp) throw new Error("Usage : node scripts/initialiser.mjs <commerces.csv> <rues.txt.gz>");

const etat = join(dirname(fileURLToPath(import.meta.url)), "..", "etat");
mkdirSync(etat, { recursive: true });
if (existsSync(join(etat, "commerces.csv"))) throw new Error("etat/ déjà initialisé");

// Tous les commerces de la région : ceux hors de la Somme disparaîtront de l'état à la première mise à jour
const commerces = readFileSync(commercesApp, "utf8").split("\n").filter(Boolean).flatMap((ligne) => {
  const [lat, lon, categorie, nom, marque, id] = ligne.split(";");
  return id ? [[id, categorie, lat, lon, nom ?? "", marque ?? "", "", ""].join(";")] : [];
});
writeFileSync(join(etat, "commerces.csv"), commerces.sort().join("\n") + "\n");

const rues = gunzipSync(readFileSync(ruesApp)).toString("utf8").split("\n")
  .filter((cle) => cle.startsWith(DEPARTEMENT));
writeFileSync(join(etat, "rues.txt.gz"), gzipSync(Buffer.from(rues.join("\n"), "utf8"), { level: 9 }));
writeFileSync(join(etat, "lotissements.csv"), "");
console.log(`${commerces.length} commerces et ${rues.length} rues de la Somme connus au départ`);
