# Wat we geleerd hebben over Alexa-skills, widgets en APL

Opgebouwd tijdens het bouwen van dit dashboard voor de Echo Show 11 (20 tot en met 22 oktober 2026). Alles hieronder is
op het toestel, in de console of met een test vastgesteld, of komt uit de genoemde Amazon-pagina. Wat niet bewezen is,
staat er als *onbevestigd* bij.

## Platform

- De Echo Show 11 (2025) draait Vega OS. Eigen apps of een eigen startscherm kunnen niet; de route is een Alexa-skill
  met APL (volledig scherm) en een widget. Alexa+ is in Nederland (oktober 2026) niet beschikbaar.
- Een eigen (custom) skill wordt in het **Nederlands niet aangeroepen**, met geen enkele aanroepnaam ("mijn dashboard",
  "mijn overzicht", "thuis overzicht"), terwijl nl-NL als skilltaal bestaat. In het Engels (en-US en en-GB) werkt
  "Alexa, open my overview" wel. Daarom staat de Show op Engels; de inhoud op het scherm blijft Nederlands.
- Het woord "dashboard" in de aanroepnaam botst met Alexa's eigen slimmehuis-dashboard ("Ik heb geen groep of apparaat
  gevonden met de naam dashboard").
- Importeren van een skill uit een repository zet de aanroepnaam op "change me"; daarna zelf zetten en bouwen.

## Het volledige scherm open houden

- `shouldEndSession: true` sluit het scherm na ongeveer een seconde. Laat het veld weg (undefined) bij antwoorden met
  een scherm: de sessie blijft open, de microfoon dicht.
- `settings.idleTimeout` in het APL-document (milliseconden) is een wens, geen garantie; 120000 gebruikt.
- Een seintje vanuit het scherm houdt de sessie open: `handleTick` met `minimumDelay` 25000 en een `SendEvent`.
  **Tick-handlers draaien in fast mode** en slaan een kale `SendEvent` over; geef het commando een eigen
  `sequencer`, dan gaat het wel.
- Het venster 06:00-10:00 regelt de skill zelf: de opentijd reist mee in het seintje en overleeft een hertekening.
  Buiten het venster gaat het scherm 15 minuten na openen dicht. Of de Echo een sessie echt vier uur openhoudt, is
  *onbevestigd*.

## APL-valkuilen

- Een `Container` met `data` die **null** is, tekent zijn kinderen toch **één keer** (zonder data). Dat gaf een los
  groen stipje en een lege regel. Zet er een `display`-voorwaarde op die de lijst controleert.
- Het kind van een `Frame` krijgt niet vanzelf de breedte van het frame; zonder `"width": "100%"` wordt het zo breed
  als de breedste regel, en wordt rechts afgekapt.
- Een kolom met `grow`/`shrink` in een rij kan toch buiten beeld schuiven; een vaste breedte
  (`${viewport.width - ...}`) is betrouwbaar. `viewport.width` en `viewport.height` zijn in dp.
- Een lange tekst in een rij kapt pas netjes af (`maxLines: 1`) als zijn container een vaste of begrensde breedte heeft.
- `Time.format('HH:mm', localTime)` geeft een lopende klok; `localTime + minuten * 60000` geeft een aankomsttijd.
- Eigenschappen als `display` op een layout-aanroep komen op de buitenste component van die layout terecht.
- Echo Show-hub in de voorbeeldweergave: 1280 x 800 dp; widgetvak WIDGET_M: 328 x 552 dp.

## Widgets

- Pakket: `manifest.json` (met `presentationDefinitions`), `presentations/default.tpl`, `documents/document.json`,
  `datasources/default.json`. Enige formaat: `WIDGET_M`.
- **Na elke wijziging aan de widget het interactiemodel opnieuw bouwen**, anders blijft de oude versie de te
  installeren versie (Amazon, "Test a Widget"). Opslaan in de widgeteditor is niet genoeg. Op 22-10 kreeg de Echo zo
  de hele dag de versie van 21-10.
- Testen: **Preview** heeft nooit een data store; **Install** + Send to Device bootst een installatie uit de Widget
  Gallery na ("Installation Simulated Successfully"). Daarna staat hij in de Widget Gallery onder In development.
- Data Store REST API, doel `USER`: per apparaat een uitslag. Op dit account gaven 11 van de 13 apparaten
  "Device does not support Alexa.DataStore" en 2 "The device does not have any package from this skill", ook na
  installeren en toevoegen op het startscherm. De knop "Update Data Store" in de widgeteditor meldt wel succes.
  Conclusie (deels *onbevestigd*): de Echo Show 11 op Vega OS krijgt via de REST API geen widgetgegevens.
- **Tweede widget in dezelfde skill** (22-10, YouTube): Multimodal Responses > Widget > Create Widget > Upload (neemt alleen het APL-document als .json), daarna DATA en MANIFEST plakken, opslaan met als naam de manifest-id, Build skill, Install + Send to Device. Het consolesjabloon zet `location == 'FAVORITE'` in `appliesTo`; wij laten dat weg.
- `OpenURL` staat in Amazons commandotabel als toegestaan in widgets. Op een toestel zonder ondersteuning wordt het stil genegeerd, zonder `onFail`; daarom toont de YouTube-widget een melding als `environment.allowOpenURL` false is. Of de Show 11 YouTube zo opent, is *onbevestigd*.
- Een widget opent het volledige scherm met `SendEvent` en `flags.interactionMode: "STANDARD"` (`INLINE` laat de
  widget staan). Maak de hele widget één `TouchWrapper`, dan werkt een tik ook zonder gegevens.

## Gegevens van de Mac naar de skill

- **Data Store REST API**: token via Login with Amazon, `client_credentials`, scope `alexa::datastore`, EU-endpoint
  `https://api.eu.amazonalexa.com/v1/datastore/commands`; hooguit 16 KB per opdracht. Werkt alleen als het toestel het
  pakket heeft (zie hierboven).
- **Skill Messaging API** (`POST /v1/skillmessages/users/{userId}`, data hooguit 6 KB, alleen tekstwaarden): Login with
  Amazon weigert de scope `alexa:skill_messaging` met `invalid_scope`, met dezelfde inloggegevens die voor de data
  store wel werken. Oorzaak niet gevonden.
- **Wat werkt**: de Mac versleutelt zijn deel met AES-256-GCM en schrijft het naar een geheime gist; de skill haalt de
  ruwe gist op (met een `?t=`-parameter tegen caching), ontsleutelt hem en voegt hem toe zolang hij hooguit 30 minuten
  oud is (`lambda/opslag.js`, `tools/gist-maken.mjs`).
- Een Alexa-hosted skill heeft een S3-bucket (`S3_PERSISTENCE_BUCKET`) en draait hier op Node 16: geen `fetch`, wel
  een terugval via `https`. `node-ical` op de Mac vraagt Node 22 of nieuwer.

## De console automatiseren (Chrome op poort 9447)

- Amazon blokkeert inloggen in een headless browser; daarom een echt venster met eigen profiel en remote debugging,
  bestuurd met Playwright over CDP (`tools/console/`).
- Code-tab: Ace-editor (`ace.edit(el).setValue`). Een bestand opent met **dubbelklik** in de boom; één klik selecteert
  alleen (op 21-10 kwam config.json daardoor in index.js terecht). Controleer de actieve tab voor je schrijft. Een
  nieuw bestand: knop New File, pad invullen.
- Widgeteditor en APL-voorbeeldweergave: Monaco zonder `window.monaco`. Plakken via het klembord (`pbcopy`, Cmd+A,
  Cmd+V); `insertText` voegt eigen haakjes toe. Controleer vóór het plakken in welk tabblad je zit.
- Test > Manual JSON: de eerste verzending na het laden van de pagina geeft niets terug; daarna wel.
- De APL-voorbeeldweergave (Displays, Blank Document, Code View, een eigen viewport) is de snelste visuele controle.
  De echte widget leest de data store; maak voor de voorbeeldweergave een kopie die `payload.ds` gebruikt.

## Google Maps Platform

- Routes API `computeRoutes` met `TRAFFIC_AWARE` valt onder Pro (5.000 gratis per maand); Maps Static API onder
  Essentials (10.000 gratis). Een kaart-URL mag 16.384 tekens zijn; donker met `colorscheme=dark`.
- De pagina Maps-API's > Credentials leidt in een nieuw project naar een startscherm dat **zelf een sleutel aanmaakt**
  en **alle Maps-API's aanzet** (vinkje). Beperk de sleutel daarna tot de nodige API's.
- Dagplafond: Quotas > rij "per day" > Kontingent bearbeiten > "Unlimited" uit > waarde > **Anfrage senden** (niet
  "Fertig") > Bestätigen.
- De sleutel zit in de kaart-URL en gaat dus mee naar Amazon en het toestel; beperken is de bescherming.

## Bronnen op de Mac

- Apple Herinneringen via JXA kostte 40-70 seconden; een klein Swift-programma met EventKit doet het in 0,5 seconde.
  De eerste keer onder launchd vraagt macOS opnieuw om toestemming.
- Claude Code-sessies: `~/.claude/sessions/<pid>.json` (status busy of idle) en het transcript per sessie; een vraag
  die nog openstaat is een tool-aanroep zonder resultaat.

## Bronnen

- Amazon, Test a Widget: https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/test-widget.html
- Amazon, Skill Messaging REST API Reference: https://developer.amazon.com/en-US/docs/alexa/smapi/skill-messaging-api-reference.html
- Amazon, Access Token Retrieval: https://developer.amazon.com/docs/alexa/smapi/access-token-api.html
- Verder de bronnen in `docs/plan.md` (onderzoek van 20 oktober).
