# TechSignalSix → X Publisher

Statisk side som viser ferdige X-poster for hele uken, generert fra [techsignalsix.com](https://techsignalsix.com).

Hver post har en **Publish to X**-knapp som åpner X med teksten ferdig fylt inn.

## Oppsett (GitHub Pages)

1. Lag et nytt GitHub-repo (f.eks. `techsignalsix-x-publisher`).
2. Last opp alle filene i denne mappen til roten av repoet:
   - `index.html`
   - `scrape.py`
   - `posts.json` (genereres, men legg gjerne med en startversjon)
   - `.github/workflows/update-posts.yml`
3. Gå til **Settings → Pages**.
   - Source: **Deploy from a branch**
   - Branch: `main` / `root`
4. Siden blir tilgjengelig på `https://<bruker>.github.io/<repo>/`.

## Automatisk oppdatering

GitHub Action kjører hver **mandag kl. 06:00 UTC** og:
- Henter data fra techsignalsix.com (RSS + homepage)
- Genererer nye poster
- Committer `posts.json`

Du kan også kjøre den manuelt under **Actions → Update X posts from TechSignalSix → Run workflow**.

## Bruk

1. Åpne siden på mandag (etter at Action har kjørt).
2. Du ser 7 kort (Monday–Sunday).
3. Trykk **Publish to X** på den dagen du vil poste.
4. X åpnes med teksten klar – juster om du vil, og post.

## Filer

| Fil | Beskrivelse |
|-----|-------------|
| `index.html` | Selve publisher-siden |
| `scrape.py` | Script som henter data og lager poster |
| `.github/workflows/update-posts.yml` | Ukentlig Action |
| `posts.json` | Generert data (oppdateres av Action) |

## Tilpasning

Du kan redigere malene i `scrape.py` → funksjonen `generate_posts()` for å endre hvordan postene ser ut.
