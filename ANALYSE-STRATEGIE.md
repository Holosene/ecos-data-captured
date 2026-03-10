# Analyse des commits et strategie de resolution

## Statistiques du repo

- **90 commits** au total
- **52 fix/revert/restore** (58%)
- **14 features** (16%)
- Ratio corrections/fonctionnalites: **3.7:1**

## Les 3 boucles infinies identifiees

### Boucle 1 — Taille git vs Fidelite

Le volume brut en memoire fait ~1.8 GB (Float32Array pleine resolution).
Le downsampling a [128,256,128] reduit a ~30 MB pour git, mais la session page
reconstruit des frames depuis ce volume downsample, ce qui donne un rendu different
de la scan page.

Commits concernes: dc361c8, f1fda44, 271fef8, 6b71a6d, 3084f79

### Boucle 2 — Reconstruction de frames ≠ frames originales

La scan page utilise les frames originales en memoire.
La session page slice le spatial volume selon Y pour reconstruire des frames.
L'interpolation trilineaire du downsampling cause des differences visibles.

Commits concernes: 8436a81, 22b492b, f1fda44, 4e3df96, 568c0d3, 98e66e5, 84abf8c

### Boucle 3 — 3 modes × 2 pages = 6 chemins de rendu

Mode A (Instrument) + Mode B (Spatial) + Mode C (Classic)
multiplies par ScanPage (donnees directes) + SessionPage (donnees reconstruites)
= 6 combinaisons a maintenir en coherence.

Commits concernes: db04dba, 9ba8482, 42a169b, 8ab2623, be82203

## Cause racine

L'architecture `publishToRepo` via Vite dev server → commit git → GitHub Pages
est une impasse. Les volumes 3D sont trop gros pour git, et le downsampling
necessaire pour respecter les contraintes de taille detruit la fidelite visuelle.

## Solutions proposees

### Option A — Export HTML autonome (RECOMMANDEE)

Exporter la page viewer en un seul fichier .html auto-contenu:
- Volumes quantifies uint16 + compression deflate (~5-15 MB)
- JS du viewer inline
- Zero reconstruction, fidelite 100%
- Partageable (un fichier, n'importe quel navigateur)
- Hebergeable (GitHub Pages, Netlify, lien direct)

### Option B — Stockage externe (GitHub Releases / CDN)

Garder l'architecture actuelle mais sortir les volumes de git:
- Upload vers GitHub Release ou S3/R2
- manifest.json pointe vers URLs externes
- Pas de limite de taille, pas de downsampling

### Option C — Quantification intelligente

Garder git mais compresser sans perte visible:
- Float32Array → Uint16Array + gzip (~10x reduction)
- Pas de downsampling spatial
- Changement minimal du code existant
