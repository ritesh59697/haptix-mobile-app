// Add a vector signed over a fixed challenge used by the ERC-20 bypass test.
import { webcrypto as c } from 'node:crypto';
import fs from 'node:fs';

const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const hx = b => Buffer.from(b).toString('hex');
const p  = n => n.toString(16).padStart(64,'0');
const b64u = b => Buffer.from(b).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

const existing = JSON.parse(fs.readFileSync('tools/vectors.json','utf8'));

// Reconstruct k0 from scratch would change the key, so instead generate a NEW
// keypair set and regenerate ALL vectors including the erc20 one. Deterministic
// enough for a test fixture.
async function mkKey() {
  const kp = await c.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, true, ['sign','verify']);
  const jwk = await c.subtle.exportKey('jwk', kp.publicKey);
  const d = s => Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');
  return { kp, x: hx(d(jwk.x)), y: hx(d(jwk.y)) };
}
async function assert(key, challengeHex, uv) {
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
  return { authData: hx(authData), cd, r: p(r), s: p(s),
           challengeIndex: cd.indexOf('"challenge":"'), typeIndex: cd.indexOf('"type":"') };
}

const k0 = await mkKey(), k1 = await mkKey();
const out = { k0:{x:k0.x,y:k0.y}, k1:{x:k1.x,y:k1.y}, vectors:{} };
for (const [name, ch, uv, key] of [
  ['small_k0',  '0x'+'11'.repeat(32), true,  k0],
  ['small_k1',  '0x'+'11'.repeat(32), true,  k1],
  ['large_k0',  '0x'+'22'.repeat(32), true,  k0],
  ['large_k1',  '0x'+'22'.repeat(32), true,  k1],
  ['other_k0',  '0x'+'33'.repeat(32), true,  k0],
  ['other_k1',  '0x'+'33'.repeat(32), true,  k1],
  ['noUV_k0',   '0x'+'44'.repeat(32), false, k0],
  ['unknown_k0','0x'+'55'.repeat(32), true,  k0],
  ['erc20_k0',  '0x'+'66'.repeat(32), true,  k0],
]) out.vectors[name] = await assert(key, ch, uv);

fs.writeFileSync('tools/vectors.json', JSON.stringify(out,null,2));
console.log('regenerated with erc20_k0');
