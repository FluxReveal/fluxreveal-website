# Badehusappen – prøveversjon

Første prøveversjon av Badehusappen for Sameiet Halden Terrasse 14.
Åpnes på <https://fluxreveal.com/HT14/badehusappen/>.

- **Ingen innlogging ennå.** Man velger bare Hus A, B, C eller D når man booker.
- **Data lagres bare i nettleseren** (localStorage) på den enkelte enheten.
  «Nullstill prøvedata» under *Mer* sletter dem.
- Ingen nøkler, tokens eller passord i koden.
- **Dagen er delt i tre** (forslag): formiddag 10–14 (`AM`), ettermiddag 14–17 (`MID`) og kveld 17–24 (`PM`).
  Man booker én eller flere; heldag = alle tre. Hver periode lagres som egen booking (felles `groupId`).
  Gamle prøvedata (08–14 / 14–24 / heldag) gjøres om automatisk første gang appen åpnes.
- **Tilpasset alle skjermer:** mobil (faner nederst), mobil liggende og nettbrett/PC (sidemeny, uka i 7 kolonner,
  dialog midt på). Følger tekststørrelse (Dynamic Type) og mørk modus.
- **Felles meny:** «‹ Sameiet HT14» øverst og under *Mer* går til startsiden. Manifestets `scope` er `../`,
  så startsiden og dokumentasjonen åpnes i samme vindu når appen er lagt på Hjem-skjermen.

## Filer

| Fil | Hva |
| --- | --- |
| `index.html` | Hele appen (kalender, Mine, Statistikk, Mer) |
| `css/app.css` | Stil. Husfargene kommer fra `rules.json` |
| `js/rules-engine.js` | Regelmotoren – rene funksjoner, samme kode skal brukes i Workeren |
| `js/store.js` | **Eneste datalag.** Async-funksjoner med samme form som Worker-API-et. Byttes ut når Workeren er klar |
| `js/app.js` | Brukergrensesnittet |
| `rules.json` | Alle regler (kan endres uten kodeendring) |
| `manifest.webmanifest`, `ikoner/` | Hjem-skjerm (PWA) |
| `sw.js` | Enkel service worker, «nett først». Bytt navnet på `CACHE` ved hver oppdatering |
| `tests/rules-engine.test.js` | Tester for regelmotoren |

## Teste

```
node --test tests/
```

Testklokke for å prøve sommerreglene: legg til `?tid=2027-06-01T10:00` i adressen
(Oslo-tid). Da vises en liten merknad øverst.

## Neste steg

Når Cloudflare Workeren er på plass, lages en ny `js/store.js` som kaller `/api/…`
(se LLD), og sidene flyttes til `public/` slik LLD beskriver.
