/* Student password hashing — salted PBKDF2-SHA256 (WebCrypto, no library).
   A student record stores:
     password      = derived hash (hex)
     passwordSalt  = random 16-byte salt (hex), unique per student
     passwordIter  = iteration count
   Records created by the older build have no passwordSalt (plain unsalted SHA-256);
   verifyPassword still accepts them so nobody is locked out, and setting a new
   password in Admin > Students upgrades them to the salted format.
   Needs https:// or localhost. */
const ITER = 120000;
const enc = new TextEncoder();
const toHex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = h => new Uint8Array(h.match(/.{2}/g).map(x => parseInt(x, 16)));

function need(){ if (!globalThis.crypto || !crypto.subtle) throw new Error("Secure connection (https) required"); }

async function pbkdf2(pw, salt, iter){
  need();
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
async function sha256(pw){
  need();
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(pw)));
}
function same(a, b){
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

// -> { password, passwordSalt, passwordIter }  (spread into the student document)
export async function hashPassword(pw){
  need();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { password: await pbkdf2(pw, salt, ITER), passwordSalt: toHex(salt), passwordIter: ITER };
}

export async function verifyPassword(pw, d){
  if (d.passwordSalt) return same(await pbkdf2(pw, fromHex(d.passwordSalt), d.passwordIter || ITER), d.password);
  return same(await sha256(pw), d.password);   // legacy unsalted record
}
