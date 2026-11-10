# Plan: wiederholte Läufe (`--runs N`)

## Ziel

Ein einzelner Lauf sagt bei einem Modell wenig, weil die Antworten schwanken.
`--runs N` misst jedes Szenario × Profil mehrfach; der Bericht zeigt Quoten mit
95-%-Wilson-Intervall und markiert Szenarien, die mal bestehen und mal nicht
(„wackelig“). Fehler der Ausführung (Zeitlimit, Absturz) zählen getrennt von
„durchgefallen“.

## Etappen

1. **Statistik als reines Modul** – `lib/stats.mjs`: Wilson-Intervall,
   Einstufung (stabil bestanden / stabil durchgefallen / wackelig / Einzelmessung),
   Gesamtquote je Profil, Profilvergleich („unterscheidbar“ nur ohne Überlappung).
   Test: `test/stats.test.mjs` (bekannte Werte).
2. **Aggregation und Berichtsformat** – `lib/report/runs.mjs`: Einzelläufe
   (`run`-Feld) je Zelle zählen, Fehler getrennt, fehlende Läufe; JSON mit
   `schemaVersion`; `readReport` liest alte Berichte (ohne Version, ein Lauf).
   Test: `test/runs.test.mjs` plus altes Fixture.
3. **Ablaufsteuerung** – `lib/multirun.mjs`: Schleife über Läufe × Modelle ×
   Profile × Szenarien mit austauschbarer Ausführung, Abbruch zwischen zwei
   Läufen, Aufwandsschätzung, Nachfrage-Regel. Test mit Attrappen-Agent
   (festes Bestanden/Durchgefallen-Muster): `test/multirun.test.mjs`.
4. **CLI** – `--runs N` (1–20), `--ja`, Aufwand vor dem Start, Nachfrage ab
   Schwelle (ohne Terminal und ohne `--ja` Abbruch), Strg-C schreibt Teilergebnisse.
   Test: `test/cli-runs.test.mjs` (nur `--dry-run` bzw. Abbruch vor dem Agenten).
5. **Bericht** – Markdown und HTML: Quote ± Bereich, wackelige Zellen markiert,
   bei N = 1 Hinweis „Einzelmessung“, fehlende Läufe genannt.
6. **Doku** – README, `BENCHMARK.md`; dieser Plan auf Endstand.

## Bewusst nicht dabei

Kein echter Messlauf, keine Änderung an Szenarien, keine neuen Zahlen in
veröffentlichten Berichten, keine neuen Abhängigkeiten. Ohne `--runs` bleibt das
Verhalten wie bisher.

## Stand

(wird am Ende aktualisiert)
