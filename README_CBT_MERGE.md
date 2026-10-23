# Brighton Heights School — portal + CBT (merged)

## Pages
| File | Who | Notes |
|---|---|---|
| index.html | public | now links to CBT Exams / Teacher Login |
| register.html | public | unchanged |
| student.html | students | new sidebar item **CBT Exam Hall** (jumps into the CBT already signed in) |
| cbt.html + cbt.css | students | CBT exam hall; own reg-number + password sign-in (same credentials as the student portal) |
| teacher.html | teachers | exams, questions, live monitor, results |
| admin.html | admin | new **CBT & Exams** group: Teachers, Subjects & Teachers, AI Exam Generator, Manual Exam, Manage Exams, CBT Results, Leaderboard |
| cbt-admin.js | — | all the new admin logic (loaded by admin.html) |
| pwhash.js | — | PBKDF2-SHA256 password hashing for student logins (used by admin, student and cbt pages) |

## Backend
Everything now runs on the school Firebase project (veil-1-bd7b5). New collections:
`teachers`, `cbtSubjects`, `cbtExams`, `cbtQuestions`, `cbtResults`.
Classes are the portal's JSS1–SS3. Exams are matched to students by class name.

## Logins
- Students: registration number + password from the `students` collection (no extra accounts). Passwords are stored only as a salted PBKDF2 hash (`passwordHash`, `passwordSalt`, `passwordIter`). Older plain-text records are converted automatically the next time the admin portal loads. Needs https (or localhost).
- Teachers: created by admin (Admin > Teachers) as Firebase Auth email/password users + a `teachers/{uid}` doc. Passwords are never stored in Firestore — Firebase Auth keeps only a salted hash. To change a password the admin sends a reset email from Edit Teacher. Deleting a teacher removes their `teachers` doc, which locks them out (remove the Auth user in the Console too if you want it gone).
- Admin: a Firebase Auth user whose uid also has a doc in the `admins` collection (see firestore.rules).

## Firestore rules
Use the full `firestore.rules` file in this zip (Firebase Console > Firestore > Rules > Publish).
Before publishing, create the admin marker doc: Firestore > Start collection `admins` > Document ID = your admin account's UID (Authentication > Users) > any field, e.g. `role: "admin"`.

## Left out on purpose (portal already has them)
CBT students / classes / bulk student import, Term Results, Announcements, Messages, Class Chat.
ad.css is no longer needed.
