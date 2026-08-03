# Presencia

Application de gestion des présences par demi-journée, multi-sociétés, avec validation mensuelle en deux étapes (cadre puis administrateur) et export PDF/Excel par société.

## Fonctionnalités

- **Connexion uniquement** : aucune inscription publique. Tous les comptes (admin et cadres) sont créés par un administrateur.
- **Multi-sociétés** : chaque cadre est rattaché à une société. L'administrateur voit toutes les sociétés et tous les plannings ; un cadre ne voit que le sien.
- **Tableau de bord** adapté au rôle : compteurs du mois et raccourcis « à faire maintenant » (sociétés prêtes à valider, cadres en retard, saisie à compléter).
- **Planning mensuel** : clic sur une demi-journée (matin/après-midi) pour choisir Présent, Non-présent, Congé ou RTT. Trois affichages au choix (grille, compact, liste), **saisie rapide au pinceau** (on active un statut puis on peint les cases), **raccourcis clavier** dans le sélecteur (1–4 pour les statuts, ⌫ pour effacer, ↵ pour appliquer à la journée entière), et deux actions groupées : « Remplir les jours ouvrés » et « Tout effacer ».
- **Validation de fin de mois en deux temps** :
  1. Chaque cadre **valide son propre mois** (verrouille ses saisies).
  2. Une fois **tous les cadres d'une société** validés, l'administrateur **valide la société** pour ce mois (verrouillage complet). L'administrateur peut réouvrir un mois cadre ou une société en cas de correction nécessaire.
- **Historique** : chaque cadre retrouve ses mois précédents avec les totaux par statut.
- **Export** PDF et Excel par société et par mois (détail par cadre, jour et demi-journée).
- **Interface mobile** : sous 900 px, le calendrier devient une liste verticale, la navigation passe en barre basse et les cibles tactiles font 44 px.
- **Aucune dépendance externe au chargement** : la police (Inter) et les icônes (Phosphor) sont servies par l'application elle-même — aucune requête vers un CDN ou vers Google Fonts.
- **Docker** : Postgres + API Node/Express + frontend Nginx, sur des ports non standards.

## Démarrage

Toute la configuration (ports, mot de passe base de données, `JWT_SECRET`, identifiants admin) est définie directement dans `docker-compose.yml` — il n'y a pas de fichier `.env` à créer. Éditez les valeurs dans `docker-compose.yml` avant le premier démarrage (au minimum `POSTGRES_PASSWORD`, `JWT_SECRET` et `ADMIN_PASSWORD`), puis :

```bash
docker compose up -d --build
```

Ports par défaut (modifiables directement dans `docker-compose.yml`) :

| Service   | Port hôte |
|-----------|-----------|
| Frontend  | 8781      |
| API       | 4790      |
| Postgres  | 6543      |

Ouvrir http://localhost:8781

Un compte administrateur est créé automatiquement au premier démarrage avec les identifiants définis par `ADMIN_EMAIL` / `ADMIN_PASSWORD` dans `docker-compose.yml` (par défaut `admin@presencia.local` / `ChangeMe123!`). **Changez ce mot de passe après la première connexion** (aucune page de changement de mot de passe en libre-service n'est fournie côté cadre ; un administrateur peut réinitialiser le mot de passe de n'importe quel compte depuis l'onglet Utilisateurs).

Si vous changez les identifiants admin dans `docker-compose.yml` *après* un premier démarrage, ils n'auront aucun effet : le compte admin n'est créé qu'une seule fois (au premier démarrage, base vide). Pour le modifier ensuite, utilisez l'écran Utilisateurs une fois connecté, ou réinitialisez le volume `presencia_pgdata`.

## Utilisation

### En tant qu'administrateur

- **Sociétés** : créer / renommer / supprimer les sociétés.
- **Utilisateurs** : créer des comptes cadre ou admin, attribuer une société à un cadre, réinitialiser un mot de passe, activer/désactiver un compte.
- **Plannings** : consulter (et corriger si besoin) le planning de n'importe quel cadre.
- **Validation & export** : pour une société et un mois donnés, suivre la validation de chaque cadre, valider la société une fois tous les cadres validés, réouvrir si besoin, télécharger le PDF ou l'Excel récapitulatif.

### En tant que cadre

- Renseigner sa présence par demi-journée sur le mois en cours (ou les mois précédents/suivants). Le plus rapide : cliquer **« Remplir les jours ouvrés »** puis ne corriger que les exceptions (congés, RTT, absences).
- Pour saisir plusieurs cases d'affilée, activer un statut dans **Saisie rapide** : chaque clic applique directement ce statut, sans passer par le sélecteur.
- Dans le sélecteur d'une demi-journée : touches **1** à **4** pour les statuts, **⌫** pour effacer, **↵** pour appliquer à la journée entière.
- En fin de mois, cliquer sur **« Valider mon mois »** : les saisies sont alors verrouillées et transmises pour validation à l'administrateur. Si une correction est nécessaire après coup, il faut qu'un administrateur réouvre le mois.
- **Historique** : retrouver les mois précédents et leurs totaux, et les rouvrir en lecture.

## Architecture technique

```
backend/    API Node.js / Express, PostgreSQL (pg), auth par cookie JWT httpOnly
frontend/   Page HTML unique (vanilla JS), servie par Nginx qui proxifie /api vers le backend
  public/css/styles.css     tokens et composants du design system (Nocturne)
  public/css/presencia.css  couche applicative du design (calendrier, navigation, statuts)
  public/css/app.css        glue : mises en page que la maquette exprimait en styles inline
  public/css/inter.css      police Inter, servie localement
  public/css/phosphor.css   sous-ensemble des 18 icônes utilisées, servi localement
docker-compose.yml
```

`styles.css` et `presencia.css` proviennent du projet Claude Design et sont à
remplacer tels quels lors d'une nouvelle exportation du design ; les
adaptations propres à l'application vivent dans `app.css` pour que cette
réimportation reste triviale. Seule modification apportée à `styles.css` :
l'`@import` vers Google Fonts a été retiré au profit de `inter.css` servi
localement.

### Modèle de données (PostgreSQL)

- `companies` — sociétés
- `users` — comptes (rôle `admin` ou `cadre`, société associée pour les cadres)
- `attendance_entries` — une ligne par utilisateur / date / demi-journée (AM ou PM) / statut
- `month_locks` — validation du mois par le cadre (`cadre_validated`)
- `company_month_validations` — validation du mois par l'administrateur pour une société entière (`admin_validated`)

Règles de verrouillage :
- Un cadre ne peut plus modifier ses saisies une fois son mois validé (`month_locks.cadre_validated = true`), tant qu'un administrateur ne l'a pas réouvert.
- Personne (y compris l'administrateur) ne peut modifier les saisies d'une société dont le mois est validé (`company_month_validations.admin_validated = true`), tant qu'il n'a pas été réouvert.
- L'administrateur ne peut valider une société pour un mois donné que si **tous** les cadres actifs de cette société ont déjà validé leur mois.

## Développement local (sans Docker)

```bash
cd backend && npm install
# variables d'env : voir backend/.env.example (pointer PGHOST vers un Postgres local)
npm start
```

Le frontend est un simple dossier de fichiers statiques (`frontend/public`) ; en développement, servez-le avec n'importe quel serveur statique qui proxifie `/api` vers `http://localhost:4790` (voir `frontend/nginx.conf` pour la configuration de référence).
