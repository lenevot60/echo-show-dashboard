# Plan en bronnen (20 oktober 2026)

Dit project voert het plan uit dat op 20-10-2026 is opgesteld voor een eigen startscherm op de Echo Show 11 (2025).
Samenvatting van wat vaststaat, met de bron:

| Vaststelling | Bron |
| --- | --- |
| De Echo Show 11 (2025) draait Vega OS; Amazon: "Can I build apps for Echo devices? No." | developer.amazon.com, blog "Announcing Vega OS", 30-09-2025 |
| Widgets worden ondersteund op de Echo Show 11 (2025 release); aantal en formaat verschillen per apparaat | Amazon Help "What Are Alexa Widgets?" |
| Een widget is een APL-document plus pakket in een skill; installeren vanuit de console met Install / Send to Device; de preview heeft geen data store | developer.amazon.com, "About Widgets and APL", "Test a Widget" (bijgewerkt 30-10-2025) |
| Pakketformaat: `manifest.json` met `presentationDefinitions`, `presentations/default.tpl`, `documents/document.json`, `datasources/default.json`; enige widgetformaat `WIDGET_M` | alexa-samples/skill-sample-plant-care-widget; "APL Package Reference" |
| Data Store REST API: `POST /v1/datastore/commands` (EU: api.eu.amazonalexa.com), LWA client credentials met scope `alexa::datastore`, `PUT_OBJECT`, target `USER` of max. 20 `DEVICES`, 16 KB per verzoek, 1 MB per skill per toestel | "Data Store REST API Reference" |
| Skill-locale nl-NL bestaat | "Develop Skills in Multiple Languages" |
| `OpenURL` is toegestaan in widgets en opent een URL in de browser van het toestel | "OpenURL Command", "Widgets Reference" |
| Niet ondersteund in widgets: EditText, Video, SpeakItem/SpeakList, LongPress | "Widgets Reference" |
| Alexa+ niet in Nederland (stand oktober 2026); uitbreiding naar meer dan tien landen in 2027 | aboutamazon.com, "Alexa+ international launch" |

## Fasen uit het plan en de stand

| Fase | Stand |
| --- | --- |
| 0 Meten op het apparaat (Alexa+ of klassiek, taal, widgetplekken, Silk, time-out) | Doe je zelf; checklist hieronder |
| 1 Opschonen met Amazons middelen (Home Content, fotoweergave, eerste-partij-widgets) | Doe je zelf op het toestel |
| 2 Proof of concept met één eigen widget | **Gebouwd**: dit project; installeren volgens README |
| 3 Eigen widgets van bestaande apps | Weer (Buienradar) en notities zitten erin; andere bronnen voeg je toe in `lambda/bronnen.js` |
| 4 Eigen "app" als APL-scherm | **Gebouwd**: `lambda/apl/dashboard.json`, te openen met stem, tik of routine |
| 5 Webdashboard in Silk | **Gebouwd** als tegel en als intent; de time-out meet je in fase 0 |
| 6 Beheer | Skill blijft in development op je account; geen certificering |

## Checklist fase 0

- [ ] Opent het menu-icoon de instellingen (Alexa+) of veeg je omlaag (klassiek)?
- [ ] Staat Nederlands als apparaattaal in de Alexa-app, en blijven de Widget Gallery en widgets dan werken?
- [ ] Hoeveel plekken heeft het widgetpaneel, en welke widgets van derden staan in de Gallery?
- [ ] Werkt "Alexa, open Silk"? Na hoeveel minuten valt een pagina terug naar het startscherm?
- [ ] Welke schakelaars staan onder Instellingen > Weergave > Home Content?
