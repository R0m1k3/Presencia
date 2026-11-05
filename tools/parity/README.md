# Parité Node / Rust

`parity.mjs` rejoue le même scénario HTTP (≈150 requêtes : routage, erreurs,
session, sociétés, utilisateurs, présences, validations, exports, limiteur)
contre l'ancienne API Node (référence, commit `f760cf6`) puis contre l'API Rust,
chacune sur une base `presencia_parity` recréée, et affiche chaque écart.

Comparé : code HTTP, corps JSON (ordre des clés compris), `Content-Type`,
`Content-Disposition`, `Allow`, `Set-Cookie` (hors valeur du JWT et date
`Expires`). Les horodatages sont d'abord vérifiés (format `Date` JS ou format
`row_to_json`), puis masqués. Le XLSX est comparé cellule par cellule (valeurs,
remplissages, fusions, nom de feuille, volets figés) ; le PDF sur son texte.

Prérequis : Node 20+, `psql` et `pdftotext` (poppler-utils), un PostgreSQL dont
le rôle peut créer des bases (variables `PG*`, `PGPORT` vaut 55432 par défaut).

```bash
git worktree add --detach ../presencia-node f760cf6
cargo build --release --manifest-path server/Cargo.toml
node tools/parity/parity.mjs --node-dir ../presencia-node/backend \
  --rust-bin server/target/release/presencia
```

L'API Node écoute sur 4791, l'API Rust sur 4790. Code de sortie 0 si aucun écart.
