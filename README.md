# Home Station webapp

Simpele responsive webapp voor GitHub Pages.

## Bestanden

- `index.html`
- `style.css`
- `script.js`

## GitHub Pages

1. Maak een nieuwe GitHub repository.
2. Upload deze drie bestanden in de hoofdmap van de repository.
3. Ga naar **Settings → Pages**.
4. Kies **Deploy from a branch**.
5. Kies branch `main` en map `/ (root)`.
6. Open daarna de GitHub Pages-link.

## Wat werkt al?

- Meetwaarden uitlezen uit Supabase.
- Laatste fietsadvies tonen.
- `advice_requested` op `true` zetten via de knop.

## Wat moet nog aan de NodeMCU?

De NodeMCU moet nog periodiek `advice_requested` uitlezen. Wanneer deze `true` is:
1. `bepaalFietsadvies()` uitvoeren.
2. Servo draaien.
3. Advies naar Supabase schrijven.
4. `advice_requested` terug op `false` zetten.
