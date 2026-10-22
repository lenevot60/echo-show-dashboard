'use strict';
/*
 * Alexa skill "Mijn dashboard" for the Echo Show 11: a widget (data store), a full-screen APL dashboard and a tile
 * that opens the own web dashboard in Silk. Built to be imported as an Alexa-hosted skill.
 */
const Alexa = require('ask-sdk-core');
const bronnen = require('./bronnen');
const { gistOpslag } = require('./opslag');
const youtube = require('./youtube');
const dashboardDocument = require('./apl/dashboard.json');

const TOKEN = 'dashboard';
const TEKST = {
  'nl-NL': {
    hier: 'Hier is je dashboard.',
    bijgewerkt: 'Bijgewerkt.',
    geenWeb: 'Er is nog geen webadres ingesteld. Zet webUrl in config punt json.',
    web: 'Ik open het webdashboard.',
    id: 'Je gebruikers-id staat op het scherm en als kaart in de Alexa-app.',
    help: 'Zeg: toon het dashboard, ververs, open het webdashboard, of toon mijn gebruikers-id.',
    dag: 'Tot later.',
    fallback: 'Dat ken ik niet. Zeg bijvoorbeeld: toon het dashboard.',
    fout: 'Er ging iets mis. Probeer het nog eens.',
    geenScherm: 'Dit dashboard werkt op een Echo met scherm.',
    kaartTitel: 'Gebruikers-id voor tools/push.mjs',
    geenHtml: 'Dit toestel kan YouTube niet over het hele scherm openen vanuit een skill.',
    geenYouTube: 'YouTube is nog niet ingesteld. Zet youtubeKey in credentials punt json en youtubeUrl in config punt json.',
    koppel: 'Koppel eerst je YouTube-account: open de Alexa-app, ga naar Vaardigheden, Mijn dashboard, en kies Account koppelen. Er staat een kaart klaar.',
    opnieuwKoppelen: 'YouTube accepteert de koppeling niet meer. Koppel je account opnieuw in de Alexa-app.',
  },
  en: {
    hier: 'Here is your dashboard.',
    bijgewerkt: 'Updated.',
    geenWeb: 'No web address is set yet. Put webUrl in config dot json.',
    web: 'Opening the web dashboard.',
    id: 'Your user id is on the screen and as a card in the Alexa app.',
    help: 'Say: show the dashboard, refresh, open the web dashboard, or show my user id.',
    dag: 'Bye.',
    fallback: 'I do not know that one. Say, for example: show the dashboard.',
    fout: 'Something went wrong. Please try again.',
    geenScherm: 'This dashboard works on an Echo with a screen.',
    kaartTitel: 'User id for tools/push.mjs',
    geenHtml: 'This device cannot open YouTube full screen from a skill.',
    geenYouTube: 'YouTube is not set up yet. Put youtubeKey in credentials dot json and youtubeUrl in config dot json.',
    koppel: 'Koppel eerst je YouTube-account: open de Alexa-app, ga naar Vaardigheden, Mijn dashboard, en kies Account koppelen. Er staat een kaart klaar.',
    opnieuwKoppelen: 'YouTube accepteert de koppeling niet meer. Koppel je account opnieuw in de Alexa-app.',
  },
};

function t(handlerInput) {
  const locale = Alexa.getLocale(handlerInput.requestEnvelope) || 'nl-NL';
  return locale.startsWith('nl') ? TEKST['nl-NL'] : TEKST.en;
}

function heeftApl(handlerInput) {
  return Boolean(Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.APL']);
}

/** Web apps in a skill (Alexa Web API for Games): YouTube full screen needs this interface. */
function heeftHtml(handlerInput) {
  return Boolean(Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.HTML']);
}

function userId(handlerInput) {
  return handlerInput.requestEnvelope.context.System.user.userId;
}

/**
 * Keep-alive settings from config.json: the screen stays while the device keeps pinging (see dashboard.json).
 * Inside schermAan (Amsterdam time, e.g. 06:00-10:00, opened by an Alexa routine) it stays; outside it, a screen
 * that was opened by hand stays handmatigMinuten after it was opened or last tapped.
 */
function blijfInstellingen() {
  const c = bronnen.config();
  return {
    blijf: c.blijfOpScherm !== false,
    verversMs: Math.max(1, Number(c.verversMinuten) || 10) * 60 * 1000,
    venster: c.schermAan && c.schermAan.van && c.schermAan.tot ? c.schermAan : null,
    handmatigMs: Math.max(1, Number(c.handmatigMinuten) || 15) * 60 * 1000,
  };
}

/** True when nu (a Date) falls inside {van: 'HH:MM', tot: 'HH:MM'}, Amsterdam time. */
function binnenVenster(nu, venster) {
  if (!venster) return true;
  const hhmm = bronnen.formatTijd(nu);
  return venster.van <= venster.tot ? hhmm >= venster.van && hhmm < venster.tot : hhmm >= venster.van || hhmm < venster.tot;
}

function renderDashboard(content, extra = {}) {
  const { blijf } = blijfInstellingen();
  return {
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: TOKEN,
    document: dashboardDocument,
    datasources: { ds: { ...content, blijf, gestart: Date.now(), ...extra } },
  };
}

function buildSkill(deps = {}) {
  const verzamel = deps.verzamel || bronnen.verzamel;
  const push = deps.push || bronnen.pushNaarDataStore;
  const credentials = deps.credentials || bronnen.credentials;
  const logger = deps.logger || console;
  const nu = deps.nu || (() => new Date());
  const youtubeDeps = { sleutel: youtube.sleutel, populair: youtube.populair, zoek: youtube.zoek, mijn: youtube.mijn, kanaal: youtube.kanaal, ...(deps.youtube || {}) };
  const opslag = deps.opslag !== undefined ? deps.opslag : gistOpslag({ ...bronnen.macBron(), fetchImpl: bronnen.fetchImplStandaard });

  /** Fields only the Mac knows; the Mac puts them, encrypted, in a secret gist (see opslag.js). */
  const MAC_VELDEN = ['route', 'vertrek', 'agenda', 'aantalAgenda', 'afval', 'taken', 'aantalTaken', 'claude'];
  const MAC_GELDIG_MS = 30 * 60 * 1000;

  /** What the skill collects itself (weather, rain), plus the Mac's last message when it is at most 30 minutes old. */
  async function inhoud(handlerInput) {
    const content = await verzamel();
    if (!opslag) return content;
    let mac = null;
    try {
      mac = await opslag.lees();
    } catch (e) {
      logger.error('Mac-gegevens niet gelezen', e);
    }
    if (!mac || !Number.isFinite(mac.ts) || nu().getTime() - mac.ts > MAC_GELDIG_MS) return content;
    const extra = {};
    for (const k of MAC_VELDEN) if (mac[k] !== undefined) extra[k] = mac[k];
    return { ...content, ...extra };
  }

  /** Fresh content, pushed to the widget of this user when the skill has its client credentials. */
  async function vernieuw(handlerInput) {
    const content = await inhoud(handlerInput);
    const creds = credentials();
    if (!creds.clientId || !creds.clientSecret) {
      logger.log('Geen client id en secret: alleen het scherm wordt bijgewerkt, de widget niet');
      return { content, gepusht: false };
    }
    try {
      const result = await push({
        content,
        target: { type: 'USER', id: userId(handlerInput) },
        endpoint: bronnen.config().datastoreEndpoint,
        creds,
      });
      logger.log('Data Store bijgewerkt', JSON.stringify(result));
      return { content, gepusht: true };
    } catch (e) {
      logger.error('Data Store niet bijgewerkt', e);
      return { content, gepusht: false, fout: String(e && e.message ? e.message : e) };
    }
  }

  const isIntent = (handlerInput, naam) =>
    Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
    Alexa.getIntentName(handlerInput.requestEnvelope) === naam;
  const isType = (handlerInput, type) => Alexa.getRequestType(handlerInput.requestEnvelope) === type;

  const ToonDashboardHandler = {
    canHandle: (h) => isType(h, 'LaunchRequest') || isIntent(h, 'OpenDashboardIntent'),
    async handle(h) {
      const s = t(h);
      logger.log('Start', Alexa.getRequestType(h.requestEnvelope), 'interfaces', Object.keys(Alexa.getSupportedInterfaces(h.requestEnvelope)).join(','));
      if (!heeftApl(h)) return h.responseBuilder.speak(s.geenScherm).getResponse();
      const content = await inhoud(h);
      // No withShouldEndSession: on a screen device the session (and the screen) then stays open, mic closed.
      return h.responseBuilder.speak(s.hier).addDirective(renderDashboard(content)).getResponse();
    },
  };

  const VerversHandler = {
    canHandle: (h) => isIntent(h, 'RefreshIntent'),
    async handle(h) {
      const s = t(h);
      const { content } = await vernieuw(h);
      const rb = h.responseBuilder.speak(s.bijgewerkt);
      if (!heeftApl(h)) return rb.withShouldEndSession(true).getResponse();
      return rb.addDirective(renderDashboard(content)).getResponse();
    },
  };

  const OpenWebHandler = {
    canHandle: (h) => isIntent(h, 'OpenWebIntent'),
    async handle(h) {
      const s = t(h);
      const content = await inhoud(h);
      if (!content.web || !heeftApl(h)) return h.responseBuilder.speak(s.geenWeb).getResponse();
      // The document opens the URL on mount (OpenURL) when openWeb is set; Silk then shows the page.
      return h.responseBuilder.speak(s.web).addDirective(renderDashboard(content, { openWeb: true })).getResponse();
    },
  };

  /**
   * YouTube full screen: start the web app (web/youtube/index.html) with a first list, or, when it is already on
   * screen in this session, send it the new list. The ASK SDK has no types for Alexa.Presentation.HTML, so the
   * directives are plain objects.
   */
  async function toonYouTube(h, { zoekterm = '', categorie = '', afspeellijst = null, verzoek = null } = {}) {
    const s = t(h);
    const url = bronnen.config().youtubeUrl;
    if (!heeftHtml(h)) {
      logger.log('Geen Alexa.Presentation.HTML op dit toestel', JSON.stringify(Alexa.getSupportedInterfaces(h.requestEnvelope)));
      return h.responseBuilder.speak(s.geenHtml).getResponse();
    }
    if (!url || !youtubeDeps.sleutel()) return h.responseBuilder.speak(s.geenYouTube).getResponse();
    // Linked Google account (Alexa account linking): the account chips read the user's own YouTube.
    const token = h.requestEnvelope.context.System.user.accessToken || '';
    const sessie = h.attributesManager.getSessionAttributes();
    const account = afspeellijst ? '@afspeellijst' : categorie.startsWith('@') ? categorie : '';
    let lijst;
    let koppelkaart = false;
    try {
      if (account && !token) {
        lijst = { titel: 'Je eigen account', categorie, items: [], melding: s.koppel };
        koppelkaart = true;
      } else if (account) {
        lijst = await youtubeDeps.mijn(account, token, { afspeellijst });
      } else {
        lijst = zoekterm ? await youtubeDeps.zoek(zoekterm) : await youtubeDeps.populair({ categorie });
      }
    } catch (e) {
      logger.error('YouTube-lijst niet opgehaald', e);
      const verlopen = account && e && (e.status === 401 || e.status === 403);
      lijst = { titel: 'YouTube', categorie, items: [], fout: String(e && e.message ? e.message : e), ...(verlopen ? { melding: s.opnieuwKoppelen } : {}) };
      koppelkaart = Boolean(verlopen);
    }
    if (koppelkaart) h.responseBuilder.withLinkAccountCard();
    lijst = youtube.beperk(lijst);
    logger.log('YouTube', sessie.youtube ? 'lijst naar de pagina' : 'start webapp', JSON.stringify({ zoekterm, categorie, items: (lijst.items || []).length, fout: lijst.fout || null }));
    if (sessie.youtube) {
      return h.responseBuilder.addDirective({ type: 'Alexa.Presentation.HTML.HandleMessage', message: { type: 'lijst', lijst, verzoek } }).getResponse();
    }
    sessie.youtube = true;
    h.attributesManager.setSessionAttributes(sessie);
    return h.responseBuilder
      .addDirective({
        type: 'Alexa.Presentation.HTML.Start',
        data: { lijst, categorieen: youtube.CATEGORIEEN, gekoppeld: Boolean(token) },
        request: { uri: url, method: 'GET' },
        configuration: { timeoutInSeconds: 300 },
      })
      .getResponse();
  }

  const OpenYouTubeHandler = {
    canHandle: (h) => isIntent(h, 'OpenYouTubeIntent'),
    handle: (h) => toonYouTube(h),
  };

  const ZoekVideoHandler = {
    canHandle: (h) => isIntent(h, 'SearchVideoIntent'),
    handle: (h) => toonYouTube(h, { zoekterm: Alexa.getSlotValue(h.requestEnvelope, 'query') || '' }),
  };

  /** Messages from the YouTube web app: a search or a category, or a ping that keeps the session open. */
  const YouTubeBerichtHandler = {
    canHandle: (h) => isType(h, 'Alexa.Presentation.HTML.Message'),
    async handle(h) {
      const m = h.requestEnvelope.request.message || {};
      logger.log('Bericht van YouTube', JSON.stringify(m));
      const verzoek = m.verzoek === undefined ? null : m.verzoek;
      if (m.type === 'zoek') return toonYouTube(h, { zoekterm: m.zoekterm || '', verzoek });
      if (m.type === 'categorie') return toonYouTube(h, { categorie: m.categorie || '', verzoek });
      if (m.type === 'afspeellijst') return toonYouTube(h, { afspeellijst: { id: String(m.id || ''), titel: String(m.titel || '') }, verzoek });
      if (m.type === 'kanaal') {
        // "Meer van …" next to the player: the latest uploads of the channel of the video that plays.
        let lijst;
        try {
          lijst = await youtubeDeps.kanaal(m.kanaalId, { token: h.requestEnvelope.context.System.user.accessToken || '' });
        } catch (e) {
          logger.error('Kanaal niet opgehaald', e);
          lijst = { titel: 'Meer van dit kanaal', items: [], fout: String(e && e.message ? e.message : e) };
        }
        const message = { type: 'kanaal', kanaalId: m.kanaalId, lijst: youtube.beperk(lijst), verzoek };
        return h.responseBuilder.addDirective({ type: 'Alexa.Presentation.HTML.HandleMessage', message }).getResponse();
      }
      return h.responseBuilder.getResponse();
    },
  };

  const ToonIdHandler = {
    canHandle: (h) => isIntent(h, 'ShowUserIdIntent'),
    async handle(h) {
      const s = t(h);
      const id = userId(h);
      const rb = h.responseBuilder.speak(s.id).withSimpleCard(s.kaartTitel, id);
      if (!heeftApl(h)) return rb.withShouldEndSession(true).getResponse();
      const content = await inhoud(h);
      return rb.addDirective(renderDashboard(content, { gebruikersId: id })).getResponse();
    },
  };

  /** The widget was installed from the Widget Gallery: fill its data store right away. */
  const WidgetGeinstalleerdHandler = {
    canHandle: (h) => isType(h, 'Alexa.DataStore.PackageManager.UsagesInstalled'),
    async handle(h) {
      logger.log('Widget geïnstalleerd voor gebruiker', userId(h), JSON.stringify(h.requestEnvelope.request.payload || {}));
      await vernieuw(h);
      return h.responseBuilder.getResponse();
    },
  };

  const WidgetVerwijderdHandler = {
    canHandle: (h) => isType(h, 'Alexa.DataStore.PackageManager.UsagesRemoved'),
    handle(h) {
      logger.log('Widget verwijderd', JSON.stringify(h.requestEnvelope.request.payload || {}));
      return h.responseBuilder.getResponse();
    },
  };

  const WidgetBijgewerktHandler = {
    canHandle: (h) => isType(h, 'Alexa.DataStore.PackageManager.UpdateRequest'),
    async handle(h) {
      logger.log('Widgetpakket bijgewerkt', JSON.stringify(h.requestEnvelope.request));
      await vernieuw(h);
      return h.responseBuilder.getResponse();
    },
  };

  const WidgetFoutHandler = {
    canHandle: (h) => isType(h, 'Alexa.DataStore.PackageManager.InstallationError'),
    handle(h) {
      logger.error('Widgetinstallatie mislukt', JSON.stringify(h.requestEnvelope.request));
      return h.responseBuilder.getResponse();
    },
  };

  /** Taps in the widget or on the full screen: SendEvent arguments[0] says what. */
  const TikHandler = {
    canHandle: (h) => isType(h, 'Alexa.Presentation.APL.UserEvent'),
    async handle(h) {
      const s = t(h);
      const actie = (h.requestEnvelope.request.arguments || [])[0];
      if (actie !== 'blijf') logger.log('Tik', JSON.stringify(h.requestEnvelope.request.arguments || []), 'interfaces', Object.keys(Alexa.getSupportedInterfaces(h.requestEnvelope)).join(','));
      if (actie === 'openYouTube') return toonYouTube(h);
      if (actie === 'openDashboard') {
        const content = await inhoud(h);
        return h.responseBuilder.addDirective(renderDashboard(content)).getResponse();
      }
      if (actie === 'refresh') {
        const { content } = await vernieuw(h);
        const vanWidget = (h.requestEnvelope.request.arguments || [])[1] === 'widget';
        if (vanWidget) return h.responseBuilder.withShouldEndSession(true).getResponse();
        return h.responseBuilder.addDirective(renderDashboard(content)).getResponse();
      }
      if (actie === 'blijf') {
        // Ping from the dashboard while it is on screen. An empty answer keeps the session (and the screen) open;
        // after verversMinuten the screen is redrawn with fresh data. Outside schermAan the screen closes once it
        // has been up handmatigMinuten.
        const { blijf, verversMs, venster, handmatigMs } = blijfInstellingen();
        if (!blijf) return h.responseBuilder.withShouldEndSession(true).getResponse();
        const args = h.requestEnvelope.request.arguments || [];
        const t0 = nu().getTime();
        const gestart = Number(args[2]);
        if (!binnenVenster(nu(), venster) && Number.isFinite(gestart) && t0 - gestart >= handmatigMs) {
          return h.responseBuilder.withShouldEndSession(true).getResponse();
        }
        const sinds = Date.parse(args[1] || '');
        if (Number.isFinite(sinds) && t0 - sinds < verversMs) return h.responseBuilder.getResponse();
        const content = await inhoud(h);
        const extra = Number.isFinite(gestart) ? { gestart } : {};
        return h.responseBuilder.addDirective(renderDashboard(content, extra)).getResponse();
      }
      logger.log('Onbekende tik', JSON.stringify(h.requestEnvelope.request.arguments || []));
      return h.responseBuilder.speak(s.fallback).getResponse();
    },
  };

  const HelpHandler = {
    canHandle: (h) => isIntent(h, 'AMAZON.HelpIntent'),
    handle: (h) => h.responseBuilder.speak(t(h).help).reprompt(t(h).help).getResponse(),
  };
  const StopHandler = {
    canHandle: (h) => isIntent(h, 'AMAZON.CancelIntent') || isIntent(h, 'AMAZON.StopIntent') || isIntent(h, 'AMAZON.NavigateHomeIntent'),
    handle: (h) => h.responseBuilder.speak(t(h).dag).withShouldEndSession(true).getResponse(),
  };
  const FallbackHandler = {
    canHandle: (h) => isIntent(h, 'AMAZON.FallbackIntent'),
    handle: (h) => h.responseBuilder.speak(t(h).fallback).reprompt(t(h).help).getResponse(),
  };
  const SessionEndedHandler = {
    canHandle: (h) => isType(h, 'SessionEndedRequest'),
    handle(h) {
      const r = h.requestEnvelope.request;
      logger.log('Sessie beëindigd', JSON.stringify({ reden: r.reason || '', fout: r.error || null }));
      return h.responseBuilder.getResponse();
    },
  };
  const FoutHandler = {
    canHandle: () => true,
    handle(h, error) {
      logger.error('Fout in de skill', error);
      return h.responseBuilder.speak(t(h).fout).getResponse();
    },
  };

  return Alexa.SkillBuilders.custom()
    .addRequestHandlers(
      ToonDashboardHandler,
      VerversHandler,
      OpenWebHandler,
      OpenYouTubeHandler,
      ZoekVideoHandler,
      YouTubeBerichtHandler,
      ToonIdHandler,
      WidgetGeinstalleerdHandler,
      WidgetVerwijderdHandler,
      WidgetBijgewerktHandler,
      WidgetFoutHandler,
      TikHandler,
      HelpHandler,
      StopHandler,
      FallbackHandler,
      SessionEndedHandler,
    )
    .addErrorHandlers(FoutHandler)
    .withCustomUserAgent('echo-show-dashboard/0.1.0');
}

exports.buildSkill = buildSkill;
exports.handler = buildSkill().lambda();
