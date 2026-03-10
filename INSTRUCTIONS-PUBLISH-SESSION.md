# Instructions — Publier une session ÉCHOS

## 1. Générer la session dans l'app

1. Ouvrir l'app ÉCHOS en local (`pnpm dev`)
2. Importer la vidéo sonar + fichier GPX
3. Configurer le beam/grid si nécessaire
4. Cliquer **Générer** et attendre la fin du pipeline
5. Dans l'étape **Visualiser**, cliquer le bouton **Publier**
   - Cela écrit les fichiers dans `public/sessions/` :
     - `<session-id>/manifest.json`
     - `<session-id>/<volume>.echos-vol` (instrument, spatial, classic)
     - `<session-id>/<track>.gpx` (si GPX importé)
   - Et met à jour `public/sessions/manifest.json` (liste globale)

## 2. Vérifier les fichiers générés

```powershell
# Windows (PowerShell)
ls apps/web/public/sessions/
```

Tu dois voir un dossier avec l'ID de session contenant les `.echos-vol` et le manifest.

## 3. Commit et push sur GitHub

```powershell
cd C:\projets_hso\ecos-data-captured\main02\git

# Ajouter les fichiers de session
git add apps/web/public/sessions/

# Commit
git commit -m "add: session <nom-descriptif>"

# Push (déclenche le déploiement GitHub Pages)
git push origin main
```

## 4. Vérifier le déploiement

- Aller sur l'onglet **Actions** du repo GitHub
- Attendre que le workflow Pages se termine (1-2 min)
- La session est accessible sur `https://holosene.github.io/ecos-data-captured/#/session/<session-id>`

## Troubleshooting

| Problème | Solution |
|----------|----------|
| `STATUS_BREAKPOINT` dans le navigateur | Le volume spatial est trop gros — vérifier que le downsampling à 128 max est actif |
| Session vide / volumes manquants | Vérifier que le bouton Publier a bien été cliqué (pas juste Sauvegarder) |
| Page session affiche un spinner infini | Vérifier que `manifest.json` global liste bien la session |
| Les fichiers `.echos-vol` sont > 50 MB | Le downsampling ne fonctionne pas — vérifier `pipeline-store.ts` `downsampleVolume()` |
