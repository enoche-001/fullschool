/* Password hashing for student logins (PBKDF2-SHA256 via the browser's WebCrypto).
   Stores: passwordHash, passwordSalt, passwordIter — never the password itself.
   Needs https:// or localhost (crypto.subtle is unavailable on plain http). */
const ITER = 120000;
const enc = new TextEncoder();
const toHex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = h => new Uint8Array(h.match(/.{2}/g).map(x => parseInt(x, 16)));

async function derive(pw, salt, iter) {
  if (!globalThis.crypto || !crypto.subtle) throw new Error("Secure connection (https) required");
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { passwordHash: await derive(pw, salt, ITER), passwordSalt: toHex(salt), passwordIter: ITER };
}

export async function verifyPassword(pw, d) {
  if (d.passwordHash && d.passwordSalt) {
    const h = await derive(pw, fromHex(d.passwordSalt), d.passwordIter || ITER);
    let diff = h.length ^ d.passwordHash.length;
    for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ (d.passwordHash.charCodeAt(i) || 0);
    return diff === 0;
  }
  // legacy record not migrated yet (admin portal converts these automatically)
  return typeof d.password === "string" && d.password === pw;
}
