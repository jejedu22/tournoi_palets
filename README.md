# Tournois de palets bretons

Application web de gestion de tournois de palets, multi-associations.
Aucune dépendance npm : Node.js ≥ 22.13 (serveur HTTP natif + `node:sqlite`).

## Lancer

```bash
npm start            # http://localhost:3000  (PORT et DB_PATH configurables)
npm test
```

Au premier lancement, `/setup` demande la création du **super-administrateur**.
Derrière un proxy HTTPS, définir `COOKIE_SECURE=1`.

## Déploiement (Docker + Traefik)

```bash
cp .env.exemple .env   # puis renseigner DOMAIN (obligatoire), CERT_RESOLVER et TRAEFIK_NETWORK selon votre Traefik
docker compose up -d --build
```

- Le conteneur rejoint le réseau Docker externe de Traefik et est exposé en HTTPS (entrypoint `websecure`,
  port interne 3000). Adaptez `CERT_RESOLVER`, `TRAEFIK_NETWORK` et le nom de l'entrypoint à votre Traefik.
- La base SQLite est dans le volume `palets-data` (`/data/tournoi.db`) : pensez à la sauvegarder.
- `TRUST_PROXY=1` (déjà dans le compose) fait lire l'IP réelle dans `X-Forwarded-For` pour la limitation des
  essais de connexion ; à ne l'activer que si l'application n'est joignable que via Traefik.
- `COOKIE_SECURE=1` réserve le cookie de session au HTTPS. Santé : `GET /healthz`.
- Au premier accès, ouvrir `https://<DOMAIN>/setup` pour créer le super-administrateur : faites-le tout de suite,
  la page est publique tant qu'aucun compte n'existe.

## Application installable (PWA)

L'application s'installe sur téléphone ou ordinateur (« Ajouter à l'écran d'accueil », ou bouton
« Installer l'appli » dans l'en-tête quand le navigateur le propose) et s'ouvre en plein écran.
Le service worker ne met en cache que les fichiers statiques et une page hors-ligne : les pages des tournois
ne sont jamais stockées sur l'appareil, et la saisie des scores nécessite une connexion.
L'installation exige le HTTPS (fourni par Traefik en production ; `localhost` fonctionne en développement).

## Fonctionnement

- **Super-administrateur** : crée les associations et leurs administrateurs.
- **Administrateur d'association** : ne voit et ne modifie que les tournois de son association.
- **Tournoi** : nombre d'équipes, nombre de poules, **nombre de qualifiés par poule** (1 à 4) et option
  **consolante**. La phase finale en découle (4 poules × 2 qualifiés → quarts de finale). Quand le total n'est pas une
  puissance de 2 (3 poules × 2 = 6 pour un tableau de 8), on choisit à la création de **repêcher les meilleurs
  suivants** ou d'**exempter** les mieux classés du premier tour.
  1. Création → renommer les équipes → tirage au sort des poules (matchs en round-robin).
  2. Saisie des scores (pas de match nul) ; classement : victoires, différence, points marqués, confrontation directe.
  3. Quand toutes les poules sont jouées : génération du tableau final (les k premiers de chaque poule,
     plus les repêchés éventuels) et, si activée, de la consolante avec les équipes éliminées
     en poule. Chaque tableau de 4 équipes ou plus (sauf 3) comporte une **petite finale** (3ᵉ place) entre les
     perdants des demi-finales. Si leur nombre n'est pas une puissance de 2, les mieux classées sont exemptées du premier tour.
