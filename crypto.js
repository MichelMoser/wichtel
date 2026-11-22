// Ende-zu-Ende-Verschlüsselung der Auslosung:
// Jede Person erzeugt bei der Anmeldung ein P-256-Schlüsselpaar. Der öffentliche Teil
// liegt in der Datenbank, der geheime Teil nur im persönlichen Link / Browser.
// Die Auslosung verschlüsselt "wen beschenkst du" für jede Person einzeln – so kann
// niemand (auch nicht die Organisatorin / der Organisator) die Zuteilung nachschauen.

const EC = { name: 'ECDH', namedCurve: 'P-256' };
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

const importPub = (p) =>
  crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: p.x, y: p.y, ext: true }, EC, false, []);
const importPriv = (p, d) =>
  crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: p.x, y: p.y, d, ext: true }, EC, false, ['deriveKey']);
const aesKey = (priv, pub, use) =>
  crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, [use]);

export async function newKeyPair() {
  const kp = await crypto.subtle.generateKey(EC, true, ['deriveKey']);
  const j = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { pub: { x: j.x, y: j.y }, secret: j.d };
}

export async function sealFor(pub, text) {
  const eph = await crypto.subtle.generateKey(EC, true, ['deriveKey']);
  const key = await aesKey(eph.privateKey, await importPub(pub), 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const e = await crypto.subtle.exportKey('jwk', eph.publicKey);
  return { epk: { x: e.x, y: e.y }, iv: b64u(iv), ct: b64u(ct) };
}

export async function openBox(box, pub, secret) {
  const key = await aesKey(await importPriv(pub, secret), await importPub(box.epk), 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(box.iv) }, key, unb64u(box.ct));
  return dec.decode(pt);
}

export async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
