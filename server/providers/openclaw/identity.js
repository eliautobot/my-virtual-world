// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The device identity a connection presents to an OpenClaw gateway (docs/features/agent-providers.md §2), made the way
// OpenClaw makes its own: an Ed25519 key pair; the device id is the SHA-256 of the raw 32-byte public key, in hex; the
// public key travels as its raw bytes in base64url; a signature is Ed25519 over the UTF-8 payload, in base64url. The
// private key is kept sealed by the server (the connection's deviceKey) and arrives with each call.
import crypto from 'node:crypto';

/** A new private key, PEM (PKCS#8). */
export function newDeviceKey() {
  return crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
}

/** The raw public key of a PEM key (either half), base64url. */
export const rawPublicKey = pem => crypto.createPublicKey(pem).export({ format: 'jwk' }).x;

/** { deviceId, publicKeyPem, privateKeyPem } from a private key; throws if it isn't an Ed25519 key. */
export function identityFrom(privateKeyPem) {
  const priv = crypto.createPrivateKey(privateKeyPem);
  if (priv.asymmetricKeyType !== 'ed25519') throw new Error('The device key is not an Ed25519 key');
  const pub = crypto.createPublicKey(priv);
  const raw = Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url');
  return { deviceId: crypto.createHash('sha256').update(raw).digest('hex'), publicKeyPem: pub.export({ type: 'spki', format: 'pem' }), privateKeyPem };
}

/** A device-auth signature: Ed25519 over the payload's UTF-8 bytes, base64url. */
export const signPayload = (privateKeyPem, payload) => crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
