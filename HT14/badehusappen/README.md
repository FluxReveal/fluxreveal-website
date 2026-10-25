# Badehusappen – prøveversjon

Første prøveversjon av Badehusappen for Sameiet Halden Terrasse 14.
Åpnes på <https://fluxreveal.com/HT14/badehusappen/>.

- **Ingen innlogging ennå.** Man velger bare Hus A, B, C eller D når man booker.
- **Data lagres bare i nettleseren** (localStorage) på den enkelte enheten.
  «Nullstill prøvedata» under *Mer* sletter dem.
- Ingen nøkler, tokens eller passord i koden.

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
| `sw.js` | Enkel service worker, «nett først» |
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
