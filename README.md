# Newtown Academy — portal + teachers + CBT

Firebase project: **veil-1-bd7b5** (config is already in every page).

## Pages
| File | Who | Notes |
|---|---|---|
| index.html + index.css | public | unchanged from the Newton build (new Firebase config only) |
| register.html + register.css | public | unchanged from the Newton build (new Firebase config only) |
| student.html + student.css | students | unchanged from the Newton build apart from the new Firebase config and the salted-password login check |
| admin.html + admin.css | admin | Newton admin + new **CBT & Exams** group: Teachers, Subjects & Teachers, AI Exam Generator, Manual Exam, Manage Exams, CBT Results, Leaderboard |
| teacher.html | teachers | exams, questions, live monitor, results — styled like Newton |
| cbt.html + cbt.css | students | CBT exam hall, same reg number + password as the student portal |
| cbt-admin.js | — | admin logic for the CBT group |
| studentauth.js | — | student Firebase Auth helpers (login address, create login), used by admin, student and cbt pages |
| firestore.rules | — | complete rules for every collection |

## Logins
- **Admin:** Firebase Auth email/password **and** a doc in `admins/{uid}`. Accounts without it are signed out of admin.html.
- **Teachers:** created in Admin > Teachers (Firebase Auth + `teachers/{uid}` doc). No password is stored in Firestore; reset by email from Edit Teacher. Deleting a teacher removes the doc and locks them out.
- **Students:** registration number + password, now on **Firebase Authentication** like teachers. Admin creates the login when a student is enrolled or created manually. The password is never written to Firestore. The same login works on student.html and cbt.html. Admin > Students > Edit > *Reset Password* gives a student a new password.

## One-time setup
1. Authentication > Sign-in method > enable Email/Password. Add your site domain under Settings > Authorized domains.
2. Authentication > Users > add the admin user and copy its UID.
3. Firestore > create collection `admins` > Document ID = that UID > field `role: "admin"`.
4. Firestore > Rules > paste `firestore.rules` > Publish.
5. In Admin > Classes create your classes (CBT uses these names). Teachers are then assigned to subject + class under Subjects & Teachers.

## CBT notes
- The AI exam generator asks for your OpenRouter key the first time and keeps it only in that browser. No key is in the code.
- Exams match students by their `class` name. Students open cbt.html (a link is in the admin sidebar).
- Paystack is still on the test key in register.html and student.html.

## Round 1 additions
- **Subjects & Teachers is class-driven.** Every compulsory and elective subject from Admin > Classes is listed with a teacher dropdown. Extra buttons: *Assign whole class*, *Bulk assign* (one subject across many classes), and *+ New teacher* inside both dialogs. Subjects created by hand (not in any class) show as "Custom".
- **Teachers > Import CSV** (`name,email,password`; blank password = generated). Passwords are shown once: download or copy them.
- **Electives:** cbt.html hides an exam from students who do not take that elective subject. Compulsory subjects and exams with no subject are unaffected.
- **Exams** now carry `session`, `term`, `shuffleQuestions`, `shuffleOptions` (all exams made before this update keep working: untagged, shuffled as before). Admin > Manage Exams > Settings edits them, and also sets the subject on older exams so the elective filter applies to them.
- **Manual Exam** has a Subject picker (from the chosen class) and accepts the numbered question format (`1. ... A. B. C. D. ... Answer: B`) as well as CSV.
- Questions get an `order` field so non-shuffled exams keep their order; CBT results store `session` and `term`.
- No change to firestore.rules in this round.

## Round 2 changes
- **Part D** – Admin > CBT Results / Manage Exams > "Send to Results": converts CBT % to the chosen column maximum (from settings/resultSettings), previews, warns before overwriting, never publishes. Run "Recalculate Positions" on the Results page afterwards (it also applies the Publish toggle).
- **Part E** – shared filter bar (`window.AF`, defined in admin.html): Session/Term/Class are shared and persist while you move between sections; Subject/Status/Search belong to each list. Applied to Results, CBT Results, Manage Exams, Leaderboard, Payments, Students, Applications; compact version on teacher.html My Exams / Results.
- Question importer (admin Manual Exam) now previews first and flags unparsable blocks by line number; teacher importer shows line numbers.
- firestore.rules: unchanged.

## Round 2 – reload / session fix (admin.html, teacher.html, cbt-admin.js)
- Admin and teacher logins now restore silently after a page reload (session-only storage, set up before auth starts). Closing the browser/tab still signs out, as before.
- A failed server lookup on reload no longer signs the admin out; only a confirmed "not an admin / not a teacher" account is signed out.
- The last open section is restored after a reload.
- New "Reload" button in both top bars: re-reads data from Firestore without reloading the page or signing out.
- student portal / cbt.html: untouched.

## Round 3 – student logins on Firebase Auth
**What changed**
- Enrolling an application and Admin > Students > Create Student now create a Firebase Auth user for the student (secondary app, so the admin stays signed in) and save `authUid` on the student record. No password or hash is stored in Firestore.
- student.html and cbt.html sign in with Firebase Auth. The reg number is turned into a private login address (`na20267k3d9@students.newtownacademy.app`, never shown, no mail is sent). `studentLogins/{REGKEY}` stores only that address so the login page can find it.
- **Reset Password** (Admin > Students > Edit): creates a fresh login for the student and unlinks the old one right away.
- Deleting a student also removes their `studentLogins` doc. The Firebase Auth user itself can only be deleted in the Firebase Console (Authentication > Users); with the student record gone it opens nothing.
- **Admin > Students > Secure logins (n)**: one-time move of existing students. Every student without a secure login gets a random password; the old hash fields are deleted. Passwords are shown once: download the CSV or copy them. The button disappears when everyone is done.
- firestore.rules: `students` is no longer publicly readable. A student can read only their own record (and update only `totalExams` / `badges` on it). Teachers and admin still read all. `cbtResults` can only be created by the signed-in student who owns the record.
- cbt.html no longer auto-logs in from sessionStorage keys; it needs a real sign-in. Sign-in lasts for the tab only (student.html survives a reload; cbt.html asks again, as before).
- pwhash.js is removed (nothing uses it now).

**Deploy in this order**
1. Firebase > Authentication > Sign-in method: Email/Password must be on (already needed for teachers).
2. Firestore > Rules: paste firestore.rules and Publish.
3. Upload the site files.
4. Admin > Students > **Secure logins** > Create secure logins > download the CSV. Students can log in once they have their new passwords. Existing students cannot log in before this step.
- New passwords must be at least 6 characters (a Firebase Auth rule).
- `payments`, `results` and `cbtExams` rules are unchanged this round.
