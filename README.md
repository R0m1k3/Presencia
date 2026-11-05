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
- **Docker** : Postgres + API Rust (axum) + frontend Nginx, sur des ports non standards. L'image de l'API est construite par GitHub Actions et publiée sur GHCR.

## Démarrage

Les secrets (mot de passe base de données, identifiants admin…) ne sont pas dans `docker-compose.yml` : ils sont lus dans un fichier `.env` à côté de lui (non versionné). Voir « Sécurité / variables obligatoires » ci-dessous.

```bash
cp .env.example .env   # puis renseignez au minimum POSTGRES_PASSWORD
docker compose pull    # image de l'API publiée sur ghcr.io
docker compose up -d --build
```

Mise à jour : `git pull && docker compose pull && docker compose up -d --build`
(`--build` ne concerne que le frontend ; l'API n'est jamais compilée sur le serveur). L'image
`ghcr.io/r0m1k3/presencia-backend` est publiée à chaque push sur `main`, avec
les étiquettes `latest` et `sha-<7 caractères>` ; `PRESENCIA_TAG` dans `.env`
permet d'en fixer une (retour arrière). Le paquet GHCR doit être public, sinon
faites d'abord `docker login ghcr.io`. Pour compiler l'image sur place :
`docker build -t ghcr.io/r0m1k3/presencia-backend:latest server`.

Le réseau Docker `nginx_default` (celui du reverse proxy de l'hôte) doit exister
avant le premier `up` : `docker network create nginx_default` s'il n'y en a pas.

### Passage de l'API Node à l'API Rust, et retour arrière

L'API Rust reprend la base existante telle quelle (même schéma, mêmes hachages
bcrypt, mêmes cookies de session) : aucune migration de données.

1. Sauvegarde : `docker compose exec presencia-db pg_dump -U presencia presencia > presencia.sql`.
2. Si les anciens mots de passe (Postgres, admin) ou le `JWT_SECRET` ont figuré
   dans l'historique public du dépôt, changez-les : `POSTGRES_PASSWORD` et
   `JWT_SECRET` dans `.env` (puis `ALTER USER presencia PASSWORD '…'` dans la
   base ; un nouveau `JWT_SECRET` déconnecte tout le monde). Le mot de passe
   admin se change dans l'interface (« Mon mot de passe ») : `ADMIN_PASSWORD`
   n'est lu que tant qu'aucun admin n'existe.
3. `git pull && docker compose pull && docker compose up -d --build`.
   L'image n'est publiée qu'après la fusion dans `main` (étiquettes `latest`
   et `sha-…`) ; pour essayer avant, compilez-la sur place (commande ci-dessus).
   Elle est construite pour linux/amd64 uniquement.

Retour à l'ancienne API Node : `git checkout f760cf6 && docker compose up -d --build`
(elle se compile sur place et relit la même base).

Ports par défaut (modifiables directement dans `docker-compose.yml`) :

| Service   | Port hôte | Accessible depuis        |
|-----------|-----------|--------------------------|
| Frontend  | 8781      | le réseau                |
| API       | 4790      | la machine hôte seulement |
| Postgres  | 6543      | la machine hôte seulement |

Le navigateur passe toujours par le frontend (qui proxifie `/api`) ; l'API et
Postgres ne sont publiés que sur `127.0.0.1`, pour l'administration locale
(psql, sauvegardes).

**`JWT_SECRET`** : laissez-le vide pour que l'API génère un secret aléatoire,
conservé en base (les sessions survivent aux redémarrages). Si vous le
renseignez, il doit faire au moins 32 caractères aléatoires ; une valeur
d'exemple ou trop courte est ignorée.

Ouvrir http://localhost:8781

Un compte administrateur est créé automatiquement au premier démarrage avec les identifiants définis par `ADMIN_EMAIL` / `ADMIN_PASSWORD` dans `.env` (sans `ADMIN_EMAIL` : `admin@presencia.local`). Sans `ADMIN_PASSWORD`, un mot de passe aléatoire est généré et affiché une seule fois dans les logs (`docker compose logs presencia-backend`). **Changez ce mot de passe après la première connexion** via « Mon mot de passe » (en bas de la barre latérale, ou l'icône cadenas sur mobile). Chaque utilisateur peut changer le sien ; un administrateur peut aussi réinitialiser celui de n'importe quel compte depuis l'onglet Utilisateurs.

Si vous changez les identifiants admin dans `.env` *après* un premier démarrage, ils n'auront aucun effet : le compte admin n'est créé qu'une seule fois (au premier démarrage, base vide). Pour le modifier ensuite, utilisez l'écran Utilisateurs une fois connecté, ou réinitialisez le volume `presencia_pgdata`.

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

## Sécurité

- Mots de passe hachés (bcrypt), 8 caractères minimum.
- Session par cookie `httpOnly` / `SameSite=Lax` / `Secure` (12 h). Mettez `COOKIE_SECURE=false` dans `.env` uniquement si l'application est servie en HTTP simple.
- Le compte est relu en base à chaque requête : désactiver un compte, changer son rôle ou réinitialiser son mot de passe prend effet immédiatement, sans attendre l'expiration de la session.
- Connexion limitée à 10 échecs par adresse e-mail sur 15 minutes.
- Un administrateur ne peut ni désactiver ni rétrograder son propre compte.
- En-têtes de sécurité (CSP, `X-Frame-Options`, `nosniff`…) posés par Nginx et par l'API.

### Sécurité / variables obligatoires

À définir dans `.env` (modèle : `.env.example`) :

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| `POSTGRES_PASSWORD` | oui (`docker compose` refuse de démarrer sans) | mot de passe Postgres, partagé par la base et l'API |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | non, premier démarrage seulement | compte admin initial ; inutiles (et à retirer) une fois le compte créé |
| `COOKIE_SECURE` | non (`true` par défaut) | `false` uniquement si le site est servi en HTTP simple |
| `JWT_SECRET` | non | vide = secret aléatoire conservé en base |

Sur une installation existante, mettez dans `POSTGRES_PASSWORD` le mot de passe avec lequel la base a été créée, ou changez-le d'abord (`ALTER USER presencia PASSWORD '...'`) — l'ancien mot de passe figure dans l'historique git.

Réseaux : seuls l'API et le frontend rejoignent le réseau partagé `nginx_default` ; Postgres n'est joignable que par l'API, sur un réseau privé à la stack.

## Architecture technique

```
server/     API Rust (axum, sqlx), PostgreSQL, auth par cookie JWT httpOnly
  src/routes/   une route par fichier, routage reproduisant celui d'Express
  src/export/   Excel (rust_xlsxwriter) et PDF (Helvetica, sans dépendance)
  migrations/   schéma, appliqué au démarrage
  tests/        tests d'intégration (une base PostgreSQL jetable par fichier)
frontend/   Page HTML unique (vanilla JS), servie par Nginx qui proxifie /api vers le backend
  public/css/styles.css     tokens et composants du design system (Nocturne)
  public/css/presencia.css  couche applicative du design (calendrier, navigation, statuts)
  public/css/app.css        glue : mises en page que la maquette exprimait en styles inline
  public/css/inter.css      police Inter, servie localement
  public/css/phosphor.css   sous-ensemble des 18 icônes utilisées, servi localement
docker-compose.yml
```

L'API Rust remplace une API Node/Express (commit `f760cf6`) sans changer le
frontend : elle reproduit exactement ses réponses (codes, messages, ordre des
clés JSON, routage insensible à la casse, contrôles de session avant le 404).
`tools/parity/` rejoue 156 requêtes sur les deux versions et compare les
réponses. Les imitations d'Express qui ne servent qu'à cette parité pourront
disparaître avec le nouveau frontend.

`migrations/` n'est pas un migrateur : les deux fichiers sont inclus dans le
binaire et appliqués au démarrage (`001` sur une base vide, `002` toujours,
idempotent). Un nouveau fichier doit être ajouté dans `src/bootstrap.rs`.

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

Prérequis : Rust stable (`rustup`) et un PostgreSQL 16 local.

```bash
cd server
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=presencia PGPASSWORD=presencia PGDATABASE=presencia
export COOKIE_SECURE=false ADMIN_PASSWORD=un-mot-de-passe
cargo run --release
```

Tests : ils créent et suppriment leurs propres bases (`presencia_t_*`) avec un
rôle qui a le droit `CREATEDB`, lu dans les mêmes variables `PG*` :

```bash
cargo test -- --test-threads=1
```

Le frontend est un simple dossier de fichiers statiques (`frontend/public`) ; en développement, servez-le avec n'importe quel serveur statique qui proxifie `/api` vers `http://localhost:4790` (voir `frontend/nginx.conf` pour la configuration de référence).
