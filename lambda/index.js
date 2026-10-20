'use strict';
/*
 * Alexa skill "Mijn dashboard" for the Echo Show 11: a widget (data store), a full-screen APL dashboard and a tile
 * that opens the own web dashboard in Silk. Built to be imported as an Alexa-hosted skill.
 */
const Alexa = require('ask-sdk-core');
const bronnen = require('./bronnen');
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
  },
};

function t(handlerInput) {
  const locale = Alexa.getLocale(handlerInput.requestEnvelope) || 'nl-NL';
  return locale.startsWith('nl') ? TEKST['nl-NL'] : TEKST.en;
}

function heeftApl(handlerInput) {
  return Boolean(Alexa.getSupportedInterfaces(handlerInput.requestEnvelope)['Alexa.Presentation.APL']);
}

function userId(handlerInput) {
  return handlerInput.requestEnvelope.context.System.user.userId;
}

function renderDashboard(content, extra = {}) {
  return {
    type: 'Alexa.Presentation.APL.RenderDocument',
    token: TOKEN,
    document: dashboardDocument,
    datasources: { ds: { ...content, ...extra } },
  };
}

function buildSkill(deps = {}) {
  const verzamel = deps.verzamel || bronnen.verzamel;
  const push = deps.push || bronnen.pushNaarDataStore;
  const logger = deps.logger || console;

  /** Fresh content, pushed to the widget of this user when the skill has its client credentials. */
  async function vernieuw(handlerInput) {
    const content = await verzamel();
    const creds = bronnen.credentials();
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
      if (!heeftApl(h)) return h.responseBuilder.speak(s.geenScherm).getResponse();
      const content = await verzamel();
      return h.responseBuilder.speak(s.hier).addDirective(renderDashboard(content)).withShouldEndSession(true).getResponse();
    },
  };

  const VerversHandler = {
    canHandle: (h) => isIntent(h, 'RefreshIntent'),
    async handle(h) {
      const s = t(h);
      const { content } = await vernieuw(h);
      const rb = h.responseBuilder.speak(s.bijgewerkt);
      if (heeftApl(h)) rb.addDirective(renderDashboard(content));
      return rb.withShouldEndSession(true).getResponse();
    },
  };

  const OpenWebHandler = {
    canHandle: (h) => isIntent(h, 'OpenWebIntent'),
    async handle(h) {
      const s = t(h);
      const content = await verzamel();
      if (!content.web || !heeftApl(h)) return h.responseBuilder.speak(s.geenWeb).getResponse();
      // The document opens the URL on mount (OpenURL) when openWeb is set; Silk then shows the page.
      return h.responseBuilder.speak(s.web).addDirective(renderDashboard(content, { openWeb: true })).withShouldEndSession(true).getResponse();
    },
  };

  const ToonIdHandler = {
    canHandle: (h) => isIntent(h, 'ShowUserIdIntent'),
    async handle(h) {
      const s = t(h);
      const id = userId(h);
      const rb = h.responseBuilder.speak(s.id).withSimpleCard(s.kaartTitel, id);
      if (heeftApl(h)) {
        const content = await verzamel();
        rb.addDirective(renderDashboard(content, { gebruikersId: id }));
      }
      return rb.withShouldEndSession(true).getResponse();
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
      if (actie === 'openDashboard') {
        const content = await verzamel();
        return h.responseBuilder.addDirective(renderDashboard(content)).withShouldEndSession(true).getResponse();
      }
      if (actie === 'refresh') {
        const { content } = await vernieuw(h);
        const vanWidget = (h.requestEnvelope.request.arguments || [])[1] === 'widget';
        const rb = h.responseBuilder;
        if (!vanWidget) rb.addDirective(renderDashboard(content));
        return rb.withShouldEndSession(true).getResponse();
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
      logger.log('Sessie beëindigd', JSON.stringify(h.requestEnvelope.request.reason || ''));
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
