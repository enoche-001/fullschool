/* Student logins on Firebase Auth (same idea as teachers).
   - A student signs in with Registration Number + password.
   - Firebase Auth needs an email, so each student gets a private login address derived from the
     reg number (it is never shown to students and no mail is ever sent to it).
   - Firebase Auth stores the password (salted hash, managed by Google). Nothing about the password
     is kept in Firestore any more.
   - students/{id}.authUid links the student record to the Auth user. Firestore rules use that link,
     so a student can only open their own record.
   - studentLogins/{REGKEY} = { email } is the only thing a signed-out visitor can read. It lets
     the login page find the right address, and lets the admin reset a password (a reset creates a
     fresh login address; the old one is simply no longer linked to anyone).
   Needs the Email/Password sign-in method enabled in Firebase Authentication. */
import { createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Change this only if you want a different private domain. It is never used for real mail.
export const STUDENT_EMAIL_DOMAIN = "students.newtownacademy.app";

// "na/2026/7k3d9 " -> "NA20267K3D9"
export function regKey(reg){ return String(reg || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

// ver 1 -> na20267k3d9@..., ver 2 -> na20267k3d9-v2@...
export function studentEmail(reg, ver = 1){
  return `${regKey(reg).toLowerCase()}${ver > 1 ? "-v" + ver : ""}@${STUDENT_EMAIL_DOMAIN}`;
}

export function genPassword(len = 8){
  const ch = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return [...a].map(x => ch[x % ch.length]).join("");
}

/* Creates the Firebase Auth user for a student using the SECONDARY auth instance, so the admin stays
   signed in. Starts at version `fromVer`; if that address is already taken (an earlier reset or a
   half-finished run) it moves to the next version.
   Returns { uid, email, ver } */
export async function createStudentLogin(secAuth, reg, password, fromVer = 1){
  for (let ver = Math.max(1, fromVer); ver < Math.max(1, fromVer) + 8; ver++){
    const email = studentEmail(reg, ver);
    try{
      const uc = await createUserWithEmailAndPassword(secAuth, email, password);
      try{ await signOut(secAuth); }catch(_){}
      return { uid: uc.user.uid, email, ver };
    }catch(e){
      if (e && e.code === "auth/email-already-in-use") continue;
      throw e;
    }
  }
  throw Object.assign(new Error("Could not find a free login address"), { code: "student/no-free-login" });
}
