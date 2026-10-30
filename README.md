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

## Fonctionnement

- **Super-administrateur** : crée les associations et leurs administrateurs.
- **Administrateur d'association** : ne voit et ne modifie que les tournois de son association.
- **Tournoi** : nombre d'équipes, nombre de poules, premier tour de la phase finale
  (finale, demi, quart, huitième, seizième) et option **consolante**.
  1. Création → renommer les équipes → tirage au sort des poules (matchs en round-robin).
  2. Saisie des scores (pas de match nul) ; classement : victoires, différence, points marqués, confrontation directe.
  3. Quand toutes les poules sont jouées : génération du tableau final (les k premiers de chaque poule,
     complétés par les meilleurs suivants si besoin) et, si activée, de la consolante avec les équipes éliminées
     en poule. Si leur nombre n'est pas une puissance de 2, les mieux classées sont exemptées du premier tour.
