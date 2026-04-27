# Pokedo — Frontend (sito vetrina)

Progetto React (Vite + TypeScript) con **solo** le pagine pubbliche: home, menu, poke builder, carrello, checkout, tavolo, ecc. Il pannello admin sta in `PokeManager/Frontend`.

## Sviluppo

```bash
npm install
npm run dev
```

- Dev: `http://127.0.0.1:5173` (proxy `/api` → Flask su `:8000`).
- Variabili: copia `.env.example` in `.env.local`. Per la vetrina in produzione imposta `VITE_PUBLIC_TENANT_TOKEN` (vedi `DEPLOY-NOTES.md` nella root del repo).

## Collegamento a PokeManager

- Da URL `/amministrazione` si viene reindirizzati al pannello (default dev `http://127.0.0.1:5174`). Imposta `VITE_POKEMANAGER_ORIGIN` se l’admin è su un altro host.
- Il footer «Amministrazione» apre la stessa origine in una nuova scheda.

## Rigenerare `App.tsx` dal monolite (solo se necessario)

Se esiste ancora una copia monolitica di `App.tsx`, lo script `tools/split-monolith-app.mjs` nella root del repo genera la vetrina e il bundle PokeManager. In uso normale modifichi direttamente i due `App.tsx` separati.
