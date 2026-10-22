'use strict';
/*
 * The Mac's part of the content (route, agenda, tasks, Claude sessions) reaches the skill through a secret gist,
 * encrypted with AES-256-GCM. The key lives only in the Mac's .env (MAC_SLEUTEL) and in the skill's credentials.json
 * (macSleutel); the gist holds ciphertext only. Chosen by Alexander on 22-10 after the device kept answering "does not
 * have any package from this skill" for the widget, and LWA refused the scope alexa:skill_messaging (invalid_scope).
 * Used by the skill (gistOpslag) and by the Mac (versleutel, through tools/push.mjs).
 */
const crypto = require('crypto');

function sleutelBytes(sleutel) {
  const b = Buffer.from(String(sleutel || ''), 'base64');
  if (b.length !== 32) throw new Error('De sleutel moet 32 bytes zijn (base64)');
  return b;
}

/** Object → { v, iv, tag, data } with base64 fields. */
function versleutel(obj, sleutel) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sleutelBytes(sleutel), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** The reverse; throws when the key is wrong or the package was changed. */
function ontsleutel(pakket, sleutel) {
  if (!pakket || pakket.v !== 1) throw new Error('Onbekend pakket');
  const d = crypto.createDecipheriv('aes-256-gcm', sleutelBytes(sleutel), Buffer.from(pakket.iv, 'base64'));
  d.setAuthTag(Buffer.from(pakket.tag, 'base64'));
  const tekst = Buffer.concat([d.update(Buffer.from(pakket.data, 'base64')), d.final()]).toString('utf8');
  return JSON.parse(tekst);
}

/** Reads and decrypts the gist; null when nothing is configured or the gist is empty. */
function gistOpslag({ url, sleutel, fetchImpl }) {
  if (!url || !sleutel) return null;
  return {
    async lees() {
      const r = await fetchImpl(`${url}?t=${Date.now()}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Gist ${r.status}`);
      return ontsleutel(JSON.parse(await r.text()), sleutel);
    },
  };
}

module.exports = { versleutel, ontsleutel, gistOpslag };
