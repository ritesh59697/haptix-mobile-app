import { webcrypto as c } from 'node:crypto';

const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const hx = b => Buffer.from(b).toString('hex');
const p  = n => n.toString(16).padStart(64,'0');
const b64u = b => Buffer.from(b).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

export async function mkKey() {
  const kp = await c.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, true, ['sign','verify']);
  const jwk = await c.subtle.exportKey('jwk', kp.publicKey);
  const d = s => Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');
  return { kp, x: '0x' + hx(d(jwk.x)), y: '0x' + hx(d(jwk.y)) };
}

export async function signChallenge(key, challengeHex, uv = true) {
  const authData = Buffer.alloc(37);
  authData[32] = uv ? 0x05 : 0x01;
  const challenge = Buffer.from(challengeHex.replace(/^0x/,''), 'hex');
  const cd = `{"type":"webauthn.get","challenge":"${b64u(challenge)}","origin":"https://localhost:5173"}`;
  const cdHash = Buffer.from(await c.subtle.digest('SHA-256', Buffer.from(cd)));
  const sig = Buffer.from(await c.subtle.sign({name:'ECDSA',hash:'SHA-256'},
    key.kp.privateKey, Buffer.concat([authData, cdHash])));
  let r = BigInt('0x'+hx(sig.subarray(0,32)));
  let s = BigInt('0x'+hx(sig.subarray(32,64)));
  if (s > N/2n) s = N - s;
  return { authData: 'hex"' + hx(authData) + '"', cd, r: '0x' + p(r), s: '0x' + p(s),
           challengeIndex: cd.indexOf('"challenge":"'), typeIndex: cd.indexOf('"type":"') };
}
