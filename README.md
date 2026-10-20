# Echo Show Dashboard

Eigen dashboard voor de Amazon Echo Show 11 (2025), binnen wat Amazon toestaat: een **widget** in de Widget Gallery,
een **volledig dashboardscherm** (APL) en een **tegel die je eigen webdashboard** in de Silk-browser opent. Alles zit
in één Alexa-skill die alleen op je eigen account draait; certificering is niet nodig.

Waarom zo: de Echo Show 11 draait Vega OS en Amazon sluit eigen apps voor Echo-apparaten uit ("Can I build apps for
Echo devices? No."). Een eigen launcher, sideloading of root bestaat er niet voor. De officiële route is een
Alexa-skill met APL, en dat is dit project. Het plan met bronnen staat in `docs/plan.md`.

## Wat erin zit

| Onderdeel                  | Waar                                                        | Wat het doet                                                                                                   |
| -------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Skillmanifest              | `skill-package/skill.json`                                  | Interfaces APL, Data Store, Package Manager, extensie `alexaext:datastore:10`; talen nl-NL en en-GB            |
| Spraakmodel                | `skill-package/interactionModels/custom/{nl-NL,en-GB}.json` | Aanroepnaam "mijn dashboard"; intents: dashboard tonen, verversen, webdashboard openen, gebruikers-id tonen  |
| Widget                     | `skill-package/dataStorePackages/dashboard-widget/`         | Formaat WIDGET_M; leest de device data store (namespace `dashboard`, key `overzicht`); knoppen Dashboard, Ververs, Web |
| Dashboardscherm            | `lambda/apl/dashboard.json`                                 | Volledig scherm voor de Show 11: weer groot, verwachting, notities, knoppen Ververs en Webdashboard             |
| Skillcode                  | `lambda/index.js`                                           | Handlers voor spraak, tikken (SendEvent), installatie van de widget, verversen en de gebruikers-id             |
| Databronnen en push        | `lambda/bronnen.js`                                         | Buienradar (gratis, geen sleutel), `notities.json`, Data Store REST API met Login with Amazon                  |
| Periodiek bijwerken        | `tools/push.mjs`, `tools/nl.dashboard.push.plist`           | Vanaf je Mac elke tien minuten de widget vullen; `--proef` laat zien wat er zou gaan                          |
| Beelden                    | `assets/`, `tools/maak-beelden.py`                          | Placeholder-icoon (450×450) en preview (328×552) voor de Widget Gallery; vervang door eigen beeld             |
| Tests                      | `lambda/test/`                                              | Node-testrunner: databronnen, push, elke handler, en de samenhang van de pakketbestanden                       |

## Hoe de gegevens stromen

1. Je zegt "Alexa, open mijn dashboard" of tikt in de widget op Dashboard. De skill haalt het weer op bij
   Buienradar, leest `notities.json` en toont het volledige scherm.
2. Zodra je de widget installeert uit de Widget Gallery, stuurt Alexa `UsagesInstalled` naar de skill. Die vult meteen
   de data store op je toestel via de Data Store REST API. De widget leest alleen die data store; een widget doet zelf
   geen netwerkverzoeken.
3. Verversen kan met je stem ("ververs"), met de knop in de widget of op het scherm, en periodiek met `tools/push.mjs`
   vanaf je Mac. Voor de push heeft de code de client id en het secret van de skill nodig en jouw gebruikers-id.
4. De webtegel voert het APL-commando `OpenURL` uit; Silk opent je pagina. Na een time-out valt het toestel terug op
   het Alexa-startscherm; dat is een beperking van het apparaat, niet van deze skill.

## Installeren (eenmalig, ongeveer een half uur)

Je hebt nodig: een Amazon-account dat op de Echo Show is ingelogd, een gratis Alexa-ontwikkelaarsaccount op
developer.amazon.com met **hetzelfde** Amazon-account, en een openbare Git-URL van deze map.

1. **Git-URL**: deze map staat openbaar op GitHub; de beeld-URL's in het widgetmanifest wijzen naar `assets/` in die
   repository. Vervang je de beelden, dan blijven de URL's gelijk.
2. **Developer Console** (developer.amazon.com/alexa/console/ask): Create Skill. Naam "Mijn dashboard", primaire
   taal **Dutch (NL)**, type Custom, hosting **Alexa-hosted (Node.js)**. Bij Templates kies je **Import skill** en
   plak je de Git-URL. Importeren duurt een paar minuten; de console maakt zelf de Lambda aan.
3. **Build > Invocations**: controleer dat de aanroepnaam "mijn dashboard" is; klik **Build Model**. Doe hetzelfde
   onder de taal English (UK) als het toestel op Engels staat.
4. **Build > Interfaces**: controleer dat Alexa Presentation Language, Data Store en Data Store Packages aan staan
   (ze komen uit `skill.json`). Sla op en bouw opnieuw als je iets wijzigt.
5. **Tools > Permissions > Alexa Skill Messaging**: kopieer Client Id en Client Secret. Maak in de code-editor van de
   console (tabblad Code) het bestand `credentials.json` naast `index.js` met de inhoud van
   `credentials.example.json`, vul de waarden in en klik **Deploy**. Zet ze ook in `.env` op je Mac (voor
   `tools/push.mjs`). Nooit committen.
6. **Test**: zet het tabblad Test op **Development**. Zeg tegen de Echo Show "Alexa, open mijn dashboard". Het volledige
   scherm verschijnt met het weer van Buienradar.
7. **Widget installeren**: Build > Multimodal Responses > Widget. Open "dashboard-widget", kies onderaan je Echo Show 11
   en klik **Install** / **Send to Device**. De widget verschijnt in het widgetpaneel. Daarna staat hij ook in de
   Widget Gallery op het toestel (menu-icoon of Widget Gallery-icoon, afhankelijk van Alexa+ of klassieke Alexa).
8. **Gebruikers-id voor de push**: zeg "Alexa, vraag mijn dashboard om mijn gebruikers-id". De id staat op het scherm en
   als kaart in de Alexa-app (Activiteit). Zet hem in `.env` als `ALEXA_USER_ID` en draai `node tools/push.mjs`.
   Werkt dat, installeer dan het launchd-sjabloon uit `tools/` voor elke tien minuten.

## Instellen

- `lambda/config.json`: titel, Buienradar-station (standaard 6344, Rotterdam; zoek een ander `stationid` in de
  feed), `webUrl` en `webTitel` voor de webtegel, en het Data Store-endpoint (EU).
- `lambda/notities.json`: korte regels voor op het dashboard, als tekst of als `{ "titel": "…", "sub": "…" }`.
- Wijzig je iets in `lambda/`, deploy dan opnieuw in de console (of push naar de Git-remote van de hosted skill).

## Grenzen die je moet kennen

- Widgets en schermen van een skill kunnen het Alexa-startscherm niet vervangen. Wat permanent zichtbaar blijft is
  het widgetpaneel; de rest is oproepbaar.
- De data store is hooguit 1 MB per skill per toestel en 16 KB per push; `tools/push.mjs` controleert de grootte.
- Een `UsagesInstalled` komt alleen binnen als `installStateChanges` op `INFORM` staat (zo ingesteld).
- Alexa+ is per oktober 2026 niet in Nederland beschikbaar; of eigen skills onder Alexa+ precies zo blijven werken
  heeft Amazon niet vastgelegd. Test de skill opnieuw zodra Alexa+ hier komt.
- De Buienradar-feed is openbaar; lees de gebruiksvoorwaarden in het veld `buienradar` van de feed voordat je hem
  anders dan privé gebruikt.

## Ontwikkelen

```
cd lambda && npm install && npm test     # 17 tests
node tools/push.mjs --proef              # wat er naar de widget zou gaan
python3 tools/maak-beelden.py assets     # placeholderbeelden opnieuw maken
```
