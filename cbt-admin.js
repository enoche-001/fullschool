/* ============================================================
   CBT ADMIN — merged into the school admin portal
   Sections: Teachers, Subjects, AI Exam Generator, Manual Exam,
   Manage Exams, CBT Results, Leaderboard
   Data lives in the school Firebase project:
   teachers, cbtSubjects, cbtExams, cbtQuestions, cbtResults
   ============================================================ */
import { getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, deleteField, query, where, orderBy, limit, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = getApp();                 // same Firebase app the admin page already created
const auth = getAuth(app);
const db = getFirestore(app);
// Secondary app: used ONLY to create/delete teacher logins so the admin stays signed in
const secApp = initializeApp(app.options, "cbt-secondary");
const secAuth = getAuth(secApp);

const FALLBACK_CLASSES = ['JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3'];
let classCache = null;
// Classes come from the portal's own `classes` collection (Admin > Classes), so CBT always matches the school's real class names.
async function getClasses(){
  if(classCache) return classCache;
  try{
    const snap = await getDocs(collection(db,"classes"));
    const names = snap.docs.map(d=>d.id).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    classCache = names.length ? names : FALLBACK_CLASSES;
  }catch(e){ classCache = FALLBACK_CLASSES; }
  return classCache;
}
// The AI key is NOT stored in the code. The admin pastes it once; it is kept only in this browser.
function getAIKey(){
  let k=""; try{k=localStorage.getItem("cbt_ai_key")||"";}catch(_){}
  if(!k){
    k=(prompt("Paste your OpenRouter API key (saved only in this browser):")||"").trim();
    if(k){try{localStorage.setItem("cbt_ai_key",k);}catch(_){}}
  }
  return k;
}

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function toast(m,t="success"){const el=$("toast");$("toastMsg").textContent=m;el.className="toast "+t+" show";setTimeout(()=>el.classList.remove("show"),3200);}
function fmtDate(ts){if(!ts)return"—";const d=ts.toDate?ts.toDate():new Date(ts);return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});}
function fmtDateTime(ts){if(!ts)return"—";const d=ts.toDate?ts.toDate():new Date(ts);return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}
function spin(btn,t){btn.disabled=true;btn.innerHTML=`<span class="spinner"></span>${t}`;}
function unspin(btn,t){btn.disabled=false;btn.innerHTML=t;}
function openMo(id){$(id).classList.add("open");}
function closeMo(id){$(id).classList.remove("open");}
window.openModal=openMo; window.closeModal=closeMo;
function calcGrade(s){if(s>=70)return"A";if(s>=60)return"B";if(s>=50)return"C";if(s>=40)return"D";return"F";}
const emptyRow=(cols,icon,msg)=>`<tr><td colspan="${cols}"><div class="empty"><p>${icon} ${msg}</p></div></td></tr>`;
const loadingRow=cols=>`<tr><td colspan="${cols}" class="empty"><p>Loading...</p></td></tr>`;

async function populateClassSel(selId){
  const sel=$(selId); if(!sel) return;
  const first=sel.options[0]?.text||"All Classes";
  sel.innerHTML=`<option value="">${first}</option>`;
  (await getClasses()).forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;sel.appendChild(o);});
}
async function populateTeacherSel(selId){
  const sel=$(selId);
  sel.innerHTML='<option value="">— Select Teacher —</option>';
  const snap=await getDocs(collection(db,"teachers"));
  snap.docs.sort((a,b)=>(a.data().name||"").localeCompare(b.data().name||"")).forEach(d=>{const o=document.createElement("option");o.value=d.id;o.textContent=d.data().name;sel.appendChild(o);});
}

/* ---------- shared helpers for classes, sessions, teachers ---------- */
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const clsSort=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
function uniqNames(arr){const seen=new Set(),out=[];arr.forEach(n=>{const k=norm(n);if(!k||seen.has(k))return;seen.add(k);out.push(String(n).trim());});return out;}
// { "SS1A": {compulsory:[...], elective:[...]} } read from Admin > Classes
async function getClassData(){
  const snap=await getDocs(collection(db,"classes")),o={};
  snap.forEach(d=>{const x=d.data();o[d.id]={compulsory:(x.compulsory||[]).map(String),elective:(x.elective||[]).map(String)};});
  return o;
}
const SESSION_LIST=["2024/2025","2025/2026","2026/2027"];
const TERM_LIST=[["First","First Term"],["Second","Second Term"],["Third","Third Term"]];
async function fillAcademic(sessId,termId,session,term){
  let a={session:"2025/2026",term:"Second"};
  try{const s=await getDoc(doc(db,"settings","academic"));if(s.exists()){a.session=s.data().session||a.session;a.term=s.data().term||a.term;}}catch(e){}
  const sv=session||a.session, tv=term||a.term;
  const list=[...SESSION_LIST]; if(sv&&!list.includes(sv))list.push(sv);
  $(sessId).innerHTML=list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join(""); $(sessId).value=sv;
  $(termId).innerHTML=TERM_LIST.map(([v,l])=>`<option value="${v}">${l}</option>`).join(""); $(termId).value=tv;
}
// fill a <select> with the subjects (compulsory + elective) of one class
async function fillSubjectSel(selId,cls,current){
  const sel=$(selId); if(!sel)return;
  let c=null; if(cls){try{c=(await getClassData())[cls]||null;}catch(e){}}
  let html='<option value="">— Not tied to a subject —</option>';
  const all=c?[...c.compulsory,...c.elective]:[];
  const seen=new Set();
  if(c){c.compulsory.forEach(n=>{if(seen.has(norm(n)))return;seen.add(norm(n));html+=`<option value="${esc(n)}">${esc(n)}</option>`;});
        c.elective.forEach(n=>{if(seen.has(norm(n)))return;seen.add(norm(n));html+=`<option value="${esc(n)}">${esc(n)} (elective)</option>`;});}
  if(current&&!all.some(n=>norm(n)===norm(current)))html+=`<option value="${esc(current)}">${esc(current)}</option>`;
  sel.innerHTML=html;
  const match=current?[...sel.options].find(o=>norm(o.value)===norm(current)):null;
  sel.value=match?match.value:"";
}
// create a teacher login + teachers/{uid} doc (secondary app keeps the admin signed in)
async function createTeacherAccount(name,email,password){
  const uc=await createUserWithEmailAndPassword(secAuth,email,password);
  await signOut(secAuth);
  await setDoc(doc(db,"teachers",uc.user.uid),{name,email,role:"teacher",createdAt:serverTimestamp()});
  return uc.user.uid;
}
function teacherErrMsg(err){
  const c=err&&err.code||"";
  if(c==="auth/email-already-in-use")return"That email is already in use.";
  if(c==="auth/weak-password")return"Password is too weak.";
  if(c==="auth/invalid-email")return"That email address is not valid.";
  return"Failed to create teacher. ["+(c||err?.message||"unknown")+"]";
}
const FLD="padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--r-sm);font-size:.85rem;width:100%;margin-bottom:8px;box-sizing:border-box";
// small "+ New teacher" box that can sit inside any modal and auto-selects the new teacher
function setupNewTeacher(containerId,selectId){
  const c=$(containerId);
  c.innerHTML=`<a href="#" class="nt-toggle" style="font-size:.78rem;font-weight:600">+ New teacher</a>
    <div class="nt-form" style="display:none;margin-top:10px;padding:12px;border:1.5px dashed var(--border);border-radius:var(--r-sm)">
      <input class="nt-name" placeholder="Full name" style="${FLD}">
      <input class="nt-email" type="email" placeholder="Email (login)" style="${FLD}">
      <input class="nt-pass" placeholder="Password (min 6 characters)" style="${FLD}">
      <button type="button" class="btn btn-p btn-sm nt-go">Create &amp; select</button></div>`;
  const form=c.querySelector(".nt-form");
  c.querySelector(".nt-toggle").addEventListener("click",e=>{e.preventDefault();form.style.display=form.style.display==="none"?"block":"none";});
  const go=c.querySelector(".nt-go");
  go.addEventListener("click",async()=>{
    const name=c.querySelector(".nt-name").value.trim(),email=c.querySelector(".nt-email").value.trim(),pw=c.querySelector(".nt-pass").value;
    if(!name||!email||!pw){toast("Fill in name, email and password.","error");return;}
    if(pw.length<6){toast("Password must be at least 6 characters.","error");return;}
    spin(go,"Creating...");
    try{
      const uid=await createTeacherAccount(name,email,pw);
      teacherList.push({id:uid,name}); teacherList.sort((a,b)=>a.name.localeCompare(b.name));
      const sel=$(selectId),o=document.createElement("option");o.value=uid;o.textContent=name;sel.appendChild(o);sel.value=uid;
      sel.dispatchEvent(new Event("change"));
      form.style.display="none";["nt-name","nt-email","nt-pass"].forEach(k=>c.querySelector("."+k).value="");
      toast(`Teacher ${name} created and selected.`);
    }catch(err){toast(teacherErrMsg(err),"error");}
    finally{unspin(go,"Create &amp; select");}
  });
}

/* ---------- password re-confirmation for destructive/edit actions ---------- */
let pendingAction=null, pendingReopen=null;
function requirePw(desc,action,reopen=null){
  pendingAction=action; pendingReopen=reopen;
  $("cbPwDesc").textContent=desc; $("cbPwInput").value=""; $("cbPwErr").style.display="none";
  openMo("moCbPw"); setTimeout(()=>$("cbPwInput").focus(),80);
}
$("cbPwCancel").addEventListener("click",()=>{closeMo("moCbPw");if(pendingReopen)openMo(pendingReopen);pendingAction=null;pendingReopen=null;});
$("cbPwOk").addEventListener("click",async()=>{
  const pw=$("cbPwInput").value, err=$("cbPwErr"), btn=$("cbPwOk");
  err.style.display="none";
  if(!pw){err.textContent="Please enter your password.";err.style.display="block";return;}
  spin(btn,"Verifying...");
  try{
    await signInWithEmailAndPassword(auth,auth.currentUser.email,pw);
    closeMo("moCbPw"); unspin(btn,"Confirm");
    const a=pendingAction; pendingAction=null; pendingReopen=null;
    if(a) await a();
  }catch(e){err.textContent="Incorrect password. Try again.";err.style.display="block";unspin(btn,"Confirm");}
});
$("cbPwInput").addEventListener("keydown",e=>{if(e.key==="Enter")$("cbPwOk").click();});
document.querySelectorAll("#moCbTeacher,#moCbTeacherEdit,#moCbSubject,#moCbSubjectEdit,#moCbPw,#moCbClassAssign,#moCbBulk,#moCbTeacherCsv,#moCbExamSet").forEach(ov=>ov.addEventListener("click",e=>{if(e.target===ov)ov.classList.remove("open");}));

/* ---------- nav hook: load data when a CBT section opens ---------- */
const LOADERS={
  cbtTeachers:()=>loadTeachers(),
  cbtSubjects:()=>loadSubjects(),
  cbtAI:()=>{populateClassSel("pubClass");fillAcademic("pubSession","pubTerm");},
  cbtManual:async()=>{await populateClassSel("meClass");fillSubjectSel("meSubject","","");fillAcademic("meSession","meTerm");},
  cbtExams:()=>loadExams(true),
  cbtResults:()=>loadResults(true),
  cbtBoard:()=>loadLeaderboard(true),
};
document.querySelectorAll(".nav-item[data-sec]").forEach(n=>n.addEventListener("click",()=>{
  const f=LOADERS[n.dataset.sec]; if(f) f();
}));

/* ============================================================
   TEACHERS  (collection: teachers — doc id = Firebase Auth uid)
   ============================================================ */
async function loadTeachers(){
  const tbody=$("cbTeachersBody");
  tbody.innerHTML=loadingRow(5);
  const snap=await getDocs(collection(db,"teachers"));
  if(snap.empty){tbody.innerHTML=emptyRow(5,"👨‍🏫","No teachers yet — click “Create Teacher”");return;}
  const subs=await getDocs(collection(db,"cbtSubjects"));
  const subCount={};subs.forEach(s=>{const t=s.data().teacherId;subCount[t]=(subCount[t]||0)+1;});
  tbody.innerHTML="";
  // one-time cleanup: older teacher docs kept a reversible copy of the password (_ph). Remove it.
  snap.docs.forEach(d=>{ if(d.data()._ph!==undefined) updateDoc(doc(db,"teachers",d.id),{_ph:deleteField()}).catch(()=>{}); });
  snap.docs.sort((a,b)=>(a.data().name||"").localeCompare(b.data().name||"")).forEach(d=>{
    const t=d.data();
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><strong>${esc(t.name||"—")}</strong></td><td>${esc(t.email||"—")}</td><td><span class="badge b-blue">${subCount[d.id]||0} subject${(subCount[d.id]||0)===1?"":"s"}</span></td><td>${fmtDate(t.createdAt)}</td><td></td>`;
    const edit=document.createElement("button");edit.className="btn btn-edit btn-sm";edit.textContent="✏️ Edit";
    edit.addEventListener("click",()=>openEditTeacher(d.id,t));
    const del=document.createElement("button");del.className="btn btn-danger btn-sm";del.textContent="🗑️ Delete";
    del.addEventListener("click",()=>requirePw(`Delete teacher "${t.name}"`,async()=>{
      const ok=await deleteTeacherAccount(d.id); if(ok)toast(`Teacher ${t.name} deleted.`); loadTeachers();
    }));
    const div=document.createElement("div");div.className="act-btns";div.appendChild(edit);div.appendChild(del);
    tr.cells[4].appendChild(div);tbody.appendChild(tr);
  });
}
async function deleteTeacherAccount(uid){
  // Removing the teachers/{uid} doc locks the teacher out (teacher.html and the Firestore rules both require it).
  // The Firebase Auth login itself can only be removed from the Firebase Console (Authentication > Users).
  await deleteDoc(doc(db,"teachers",uid));
  toast("Teacher removed. They can no longer sign in to the Teacher Portal.");
  return true;
}
$("cbOpenTeacher").addEventListener("click",()=>{
  ["cbTName","cbTEmail","cbTPass"].forEach(i=>$(i).value="");
  $("cbTCreds").style.display="none";
  unspin($("cbTSubmit"),"Create Teacher"); openMo("moCbTeacher");
});
$("cbTCancel").addEventListener("click",()=>closeMo("moCbTeacher"));
$("cbTSubmit").addEventListener("click",async()=>{
  const name=$("cbTName").value.trim(), email=$("cbTEmail").value.trim(), password=$("cbTPass").value, btn=$("cbTSubmit");
  if(!name||!email||!password){toast("Please fill in all fields.","error");return;}
  if(password.length<6){toast("Password must be at least 6 characters.","error");return;}
  spin(btn,"Creating...");
  try{
    const uc=await createUserWithEmailAndPassword(secAuth,email,password);
    await signOut(secAuth);
    await setDoc(doc(db,"teachers",uc.user.uid),{name,email,role:"teacher",createdAt:serverTimestamp()});
    $("cbTCredsEmail").textContent=email; $("cbTCredsPass").textContent=password; $("cbTCreds").style.display="block";
    toast(`Teacher ${name} created!`); loadTeachers();
    btn.textContent="Done — Add Another"; btn.disabled=false;
    btn.onclick=()=>{["cbTName","cbTEmail","cbTPass"].forEach(i=>$(i).value="");$("cbTCreds").style.display="none";btn.onclick=null;btn.textContent="Create Teacher";};
  }catch(err){
    toast(teacherErrMsg(err),"error"); unspin(btn,"Create Teacher");
  }
});
/* ---------- bulk teacher import (CSV: name, email, password) ---------- */
function parseCsvLine(line){
  const out=[];let cur="",q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}
    else if(ch==='"')q=true;
    else if(ch===","||ch==="\t"){out.push(cur.trim());cur="";}
    else cur+=ch;
  }
  out.push(cur.trim());return out;
}
function genPass(){
  const ch="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789",a=new Uint32Array(9);
  crypto.getRandomValues(a);return[...a].map(x=>ch[x%ch.length]).join("");
}
let tcsvRows=[],tcsvRan=false;
function renderTcsv(){
  const ok=tcsvRows.filter(r=>!r.err).length,bad=tcsvRows.filter(r=>r.err&&!r.status).length;
  const made=tcsvRows.filter(r=>r.status==="created").length,fail=tcsvRows.filter(r=>r.status==="failed"||r.status==="exists").length;
  $("tcsvInfo").innerHTML=!tcsvRows.length?"Paste or upload, then press Check.":
    tcsvRan?`<strong>${made}</strong> created${fail?`, <strong style="color:var(--err)">${fail} not created</strong>`:""}.`
    :`<strong>${ok}</strong> ready${bad?`, <strong style="color:var(--err)">${bad} with problems</strong> (they will be skipped)`:""}.`;
  $("tcsvList").innerHTML=tcsvRows.length?`<table style="width:100%;font-size:.78rem"><thead><tr><th>Name</th><th>Email</th><th>Password</th><th>Status</th></tr></thead><tbody>`+
    tcsvRows.map(r=>{
      const st=r.status==="created"?'<span class="badge b-green">Created</span>':r.status==="working"?"…":r.status==="exists"?'<span class="badge b-gold">Email already used</span>':r.status==="failed"?`<span class="badge b-red">Failed [${esc(r.err)}]</span>`:r.err?`<span class="badge b-red">${esc(r.err)}</span>`:'<span class="badge b-blue">Ready</span>';
      return`<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${r.err&&!r.status?"—":esc(r.password)}${r.gen?" <em>(generated)</em>":""}</td><td>${st}</td></tr>`;
    }).join("")+"</tbody></table>":"";
  $("tcsvRun").disabled=tcsvRan||!ok;
  $("tcsvDone").style.display=made?"flex":"none";
}
function checkTeacherCsv(){
  const lines=($("tcsvText").value||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const seen=new Set();tcsvRows=[];tcsvRan=false;
  lines.forEach((l,i)=>{
    const c=parseCsvLine(l);
    if(i===0&&/^name$/i.test(c[0]||""))return;
    const r={name:c[0]||"",email:(c[1]||"").toLowerCase(),password:c[2]||"",status:"",err:"",gen:false};
    if(!r.name)r.err="Missing name";
    else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))r.err="Invalid email";
    else if(seen.has(r.email))r.err="Duplicate in file";
    else if(r.password&&r.password.length<6)r.err="Password under 6 characters";
    seen.add(r.email);
    if(!r.err&&!r.password){r.password=genPass();r.gen=true;}
    tcsvRows.push(r);
  });
  renderTcsv();
}
$("cbOpenTeacherCsv").addEventListener("click",()=>{
  $("tcsvText").value="";$("tcsvFile").value="";tcsvRows=[];tcsvRan=false;renderTcsv();openMo("moCbTeacherCsv");
});
$("tcsvClose").addEventListener("click",()=>closeMo("moCbTeacherCsv"));
$("tcsvCheck").addEventListener("click",checkTeacherCsv);
$("tcsvFile").addEventListener("change",()=>{
  const f=$("tcsvFile").files[0];if(!f)return;
  const rd=new FileReader();rd.onload=e=>{$("tcsvText").value=e.target.result;checkTeacherCsv();};rd.readAsText(f);
});
$("tcsvRun").addEventListener("click",async()=>{
  const todo=tcsvRows.filter(r=>!r.err&&!r.status);if(!todo.length)return;
  const btn=$("tcsvRun");spin(btn,"Creating...");$("tcsvCheck").disabled=true;
  for(const r of todo){
    r.status="working";renderTcsv();
    try{await createTeacherAccount(r.name,r.email,r.password);r.status="created";}
    catch(e){r.status=e.code==="auth/email-already-in-use"?"exists":"failed";r.err=e.code||e.message||"error";}
    renderTcsv();
  }
  tcsvRan=true;renderTcsv();unspin(btn,"Create teachers");$("tcsvCheck").disabled=false;$("tcsvRun").disabled=true;
  toast("Teacher import finished. Save the passwords now.");loadTeachers();
});
const tcsvCreds=()=>tcsvRows.filter(r=>r.status==="created");
$("tcsvDl").addEventListener("click",()=>{
  const q=v=>`"${String(v).replace(/"/g,'""')}"`;
  const csv="name,email,password\n"+tcsvCreds().map(r=>[r.name,r.email,r.password].map(q).join(",")).join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="teacher_credentials.csv";a.click();
});
$("tcsvCopy").addEventListener("click",async()=>{
  const t=tcsvCreds().map(r=>`${r.name} | ${r.email} | ${r.password}`).join("\n");
  try{await navigator.clipboard.writeText(t);toast("Credentials copied.");}catch(e){toast("Could not copy. Use Download instead.","error");}
});
function openEditTeacher(uid,data){
  $("cbETId").value=uid; $("cbETName").value=data.name||""; $("cbETEmail").value=data.email||"";
  openMo("moCbTeacherEdit");
}
$("cbETCancel").addEventListener("click",()=>closeMo("moCbTeacherEdit"));
// Passwords are never stored by the app. Firebase Auth keeps only a salted hash, so a reset goes by email.
$("cbETReset").addEventListener("click",async()=>{
  const email=$("cbETEmail").value, btn=$("cbETReset");
  if(!email){toast("This teacher has no email on record.","error");return;}
  spin(btn,"Sending...");
  try{await sendPasswordResetEmail(auth,email);toast("Password reset email sent to "+email);}
  catch(e){toast("Could not send reset email.","error");}
  unspin(btn,"Send password reset email");
});
$("cbETSave").addEventListener("click",()=>{
  closeMo("moCbTeacherEdit");
  requirePw("Save teacher changes",async()=>{
    const uid=$("cbETId").value, name=$("cbETName").value.trim();
    if(!name){toast("Please enter teacher name.","error");return;}
    const upd={name};
    await updateDoc(doc(db,"teachers",uid),upd);
    // keep teacher name on their subjects/exams in sync
    try{
      const s=await getDocs(query(collection(db,"cbtSubjects"),where("teacherId","==",uid)));
      for(const x of s.docs) await updateDoc(doc(db,"cbtSubjects",x.id),{teacherName:name});
    }catch(_){}
    toast("Teacher updated!"); loadTeachers();
  },"moCbTeacherEdit");
});

/* ============================================================
   SUBJECTS  (collection: cbtSubjects — links a subject + class to a teacher)
   ============================================================ */
let subjRows=[], teacherList=[];
async function loadTeacherList(){
  const snap=await getDocs(collection(db,"teachers"));
  teacherList=snap.docs.map(d=>({id:d.id,name:d.data().name||d.data().email||"Teacher"})).sort((a,b)=>a.name.localeCompare(b.name));
  return teacherList;
}
async function loadSubjects(){
  const tbody=$("cbSubjectsBody");
  tbody.innerHTML=loadingRow(5);
  classCache=null;
  try{
    const [cd,snap]=await Promise.all([getClassData(),getDocs(collection(db,"cbtSubjects")),loadTeacherList()]);
    const existing=snap.docs.map(d=>({id:d.id,...d.data()}));
    const used=new Set(); subjRows=[];
    Object.keys(cd).sort(clsSort).forEach(cls=>{
      const seen=new Set();
      const add=(name,type)=>{
        const k=norm(name); if(!k||seen.has(k))return; seen.add(k);
        const ex=existing.find(e=>(e.classId||e.className)===cls&&norm(e.name)===k);
        if(ex)used.add(ex.id);
        subjRows.push({kind:"class",cls,name,type,doc:ex||null});
      };
      cd[cls].compulsory.forEach(n=>add(n,"Compulsory"));
      cd[cls].elective.forEach(n=>add(n,"Elective"));
    });
    existing.filter(e=>!used.has(e.id)).sort((a,b)=>clsSort(a.className||"",b.className||"")).forEach(e=>subjRows.push({kind:"custom",cls:e.classId||e.className||"—",name:e.name||"—",type:"Custom",doc:e}));
    const fc=$("cbSubFClass"),keep=fc.value;
    fc.innerHTML='<option value="">All Classes</option>'+[...new Set(subjRows.map(r=>r.cls))].sort(clsSort).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    fc.value=[...fc.options].some(o=>o.value===keep)?keep:"";
    renderSubjects();
  }catch(e){console.error(e);tbody.innerHTML=emptyRow(5,"⚠️","Could not load subjects. Check your connection and try again.");}
}
function updateSubSummary(){
  const cls=subjRows.filter(r=>r.kind==="class");
  const un=cls.filter(r=>!(r.doc&&r.doc.teacherId)).length;
  $("cbSubSummary").innerHTML=cls.length
    ?`<strong>${cls.length-un}</strong> of <strong>${cls.length}</strong> class subjects have a teacher · `+(un?`<span style="color:var(--err)"><strong>${un} unassigned</strong></span>`:"all assigned ✅")
    :"No class subjects found yet. Add compulsory and elective subjects under Classes first.";
}
function renderSubjects(){
  const tbody=$("cbSubjectsBody");
  const q=($("cbSubFSearch").value||"").toLowerCase(), fc=$("cbSubFClass").value, fs=$("cbSubFStatus").value;
  const vis=subjRows.filter(r=>{
    if(fc&&r.cls!==fc)return false;
    const has=!!(r.doc&&r.doc.teacherId);
    if(fs==="un"&&has)return false; if(fs==="as"&&!has)return false;
    if(q&&!((r.name||"").toLowerCase().includes(q)||(r.doc?.teacherName||"").toLowerCase().includes(q)))return false;
    return true;
  });
  updateSubSummary();
  if(!vis.length){tbody.innerHTML=emptyRow(5,"📚",subjRows.length?"No subjects match these filters":"No subjects yet — add subjects under Classes, or use + Create Subject");return;}
  tbody.innerHTML="";
  vis.forEach(r=>{
    const has=!!(r.doc&&r.doc.teacherId);
    const tb=r.type==="Compulsory"?"b-blue":r.type==="Elective"?"b-gold":"b-green";
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><strong>${esc(r.name)}</strong></td><td><span class="badge b-gold">${esc(r.cls)}</span></td><td><span class="badge ${tb}">${r.type}</span></td><td></td><td></td>`;
    if(r.kind==="class"){
      const sel=document.createElement("select");sel.className="cb-sel";sel.style.maxWidth="230px";
      sel.innerHTML='<option value="">— Unassigned —</option>'+teacherList.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join("");
      if(has&&!teacherList.some(t=>t.id===r.doc.teacherId)){const o=document.createElement("option");o.value=r.doc.teacherId;o.textContent=(r.doc.teacherName||"Removed teacher")+" (account removed)";sel.appendChild(o);}
      sel.value=has?r.doc.teacherId:"";sel.dataset.prev=sel.value;
      if(!has)sel.style.borderColor="var(--err-b)";
      sel.addEventListener("change",async()=>{
        const v=sel.value,prev=sel.dataset.prev||"";
        if(!v){
          sel.value=prev; if(!r.doc)return;
          requirePw(`Remove the teacher from ${r.name} (${r.cls})`,async()=>{await deleteDoc(doc(db,"cbtSubjects",r.doc.id));r.doc=null;toast("Teacher removed from this subject.");renderSubjects();});
          return;
        }
        sel.disabled=true;
        try{
          const t=teacherList.find(x=>x.id===v),tname=t?.name||"";
          if(r.doc){await updateDoc(doc(db,"cbtSubjects",r.doc.id),{teacherId:v,teacherName:tname});r.doc={...r.doc,teacherId:v,teacherName:tname};}
          else{const ref=await addDoc(collection(db,"cbtSubjects"),{name:r.name,classId:r.cls,className:r.cls,teacherId:v,teacherName:tname,source:"class",createdAt:serverTimestamp()});r.doc={id:ref.id,name:r.name,classId:r.cls,className:r.cls,teacherId:v,teacherName:tname};}
          sel.dataset.prev=v;sel.style.borderColor="";updateSubSummary();toast(`${r.name} (${r.cls}) → ${tname}`);
        }catch(e){console.error(e);sel.value=prev;toast("Could not save. Try again.","error");}
        finally{sel.disabled=false;}
      });
      tr.cells[3].appendChild(sel);
    }else{
      tr.cells[3].textContent=r.doc.teacherName||"—";
      const edit=document.createElement("button");edit.className="btn btn-edit btn-sm";edit.textContent="✏️ Edit";
      edit.addEventListener("click",()=>openEditSubject(r.doc.id,r.doc));
      const del=document.createElement("button");del.className="btn btn-danger btn-sm";del.textContent="🗑️ Delete";
      del.addEventListener("click",()=>requirePw(`Delete subject "${r.name}"`,async()=>{await deleteDoc(doc(db,"cbtSubjects",r.doc.id));toast(`Subject "${r.name}" deleted.`);loadSubjects();}));
      const div=document.createElement("div");div.className="act-btns";div.appendChild(edit);div.appendChild(del);tr.cells[4].appendChild(div);
    }
    tbody.appendChild(tr);
  });
}
["input","change"].forEach(ev=>{$("cbSubFSearch").addEventListener(ev,renderSubjects);$("cbSubFClass").addEventListener(ev,renderSubjects);$("cbSubFStatus").addEventListener(ev,renderSubjects);});

/* ---- assignment planning (shared by "whole class" and "bulk assign") ---- */
function planAssign(cls,name,tid,repl,existing){
  const ex=existing.find(e=>(e.classId||e.className)===cls&&norm(e.name)===norm(name));
  if(!ex)return{act:"create",name,cls};
  if(tid&&ex.teacherId===tid)return{act:"same",ex,name,cls};
  if(ex.teacherId&&!repl)return{act:"skip",ex,name,cls};
  return{act:"update",ex,name,cls};
}
async function applyPlans(plans,tid){
  const tname=teacherList.find(x=>x.id===tid)?.name||"";
  let batch=writeBatch(db),n=0,created=0,updated=0;
  for(const p of plans){
    if(p.act==="create"){batch.set(doc(collection(db,"cbtSubjects")),{name:p.name,classId:p.cls,className:p.cls,teacherId:tid,teacherName:tname,source:"class",createdAt:serverTimestamp()});created++;n++;}
    else if(p.act==="update"){batch.update(doc(db,"cbtSubjects",p.ex.id),{teacherId:tid,teacherName:tname});updated++;n++;}
    if(n>=400){await batch.commit();batch=writeBatch(db);n=0;}
  }
  if(n)await batch.commit();
  return{created,updated};
}
const countActs=plans=>{const c={create:0,update:0,skip:0,same:0};plans.forEach(p=>c[p.act]++);return c;};

/* ---- assign a whole class to one teacher ---- */
let cacExisting=[];
async function cacPlan(){
  const cls=$("cacClass").value; if(!cls)return null;
  const c=(await getClassData())[cls]; if(!c)return null;
  const names=uniqNames([...c.compulsory,...($("cacElec").checked?c.elective:[])]);
  const tid=$("cacTeacher").value;
  return{cls,tid,names,plans:names.map(n=>planAssign(cls,n,tid,$("cacRepl").checked,cacExisting))};
}
async function updateCacPreview(){
  const el=$("cacPreview"),pl=await cacPlan();
  if(!pl){el.textContent="Choose a class and a teacher.";return;}
  if(!pl.names.length){el.textContent=`${pl.cls} has no subjects yet. Add them under Classes first.`;return;}
  const c=countActs(pl.plans);
  el.innerHTML=`<strong>${pl.cls}</strong> has <strong>${pl.names.length}</strong> subject${pl.names.length===1?"":"s"}. `+
    `<strong>${c.create+c.update}</strong> will be assigned`+(c.same?`, ${c.same} already with this teacher`:"")+(c.skip?`, <strong>${c.skip}</strong> already have another teacher and will be kept`:"")+".";
}
$("cbOpenClassAssign").addEventListener("click",async()=>{
  classCache=null;
  await Promise.all([populateClassSel("cacClass"),populateTeacherSel("cacTeacher"),loadTeacherList()]);
  cacExisting=(await getDocs(collection(db,"cbtSubjects"))).docs.map(d=>({id:d.id,...d.data()}));
  $("cacElec").checked=true;$("cacRepl").checked=false;
  setupNewTeacher("cacNewT","cacTeacher");updateCacPreview();openMo("moCbClassAssign");
});
["cacClass","cacTeacher","cacElec","cacRepl"].forEach(id=>$(id).addEventListener("change",updateCacPreview));
$("cacCancel").addEventListener("click",()=>closeMo("moCbClassAssign"));
$("cacApply").addEventListener("click",async()=>{
  const pl=await cacPlan(),btn=$("cacApply");
  if(!pl){toast("Choose a class first.","error");return;}
  if(!pl.tid){toast("Choose a teacher.","error");return;}
  const todo=pl.plans.filter(p=>p.act==="create"||p.act==="update");
  if(!todo.length){toast("Nothing to change for this class.","error");return;}
  spin(btn,"Assigning...");
  try{
    const r=await applyPlans(todo,pl.tid);
    toast(`${pl.cls}: ${r.created+r.updated} subject${r.created+r.updated===1?"":"s"} assigned.`);
    closeMo("moCbClassAssign");loadSubjects();
  }catch(e){console.error(e);toast("Could not assign. Try again.","error");}
  finally{unspin(btn,"Assign");}
});

/* ---- bulk: one subject + one teacher across many classes ---- */
let cbkExisting=[],cbkData={};
function cbkChecked(){return[...$("cbkClasses").querySelectorAll("input[type=checkbox]:checked")].map(i=>i.value);}
function updateCbkPreview(){
  const el=$("cbkPreview"),tid=$("cbkTeacher").value,sub=$("cbkSubject").value,cl=cbkChecked();
  if(!tid||!sub||!cl.length){el.textContent="Choose a teacher, a subject and classes.";return;}
  const c=countActs(cl.map(k=>planAssign(k,sub,tid,$("cbkRepl").checked,cbkExisting)));
  el.innerHTML=`<strong>${c.create+c.update}</strong> of ${cl.length} class${cl.length===1?"":"es"} will be assigned`+(c.same?`, ${c.same} already with this teacher`:"")+(c.skip?`, <strong>${c.skip}</strong> already have another teacher and will be kept`:"")+".";
}
function buildCbkClasses(){
  const sub=$("cbkSubject").value,box=$("cbkClasses");
  if(!sub){box.innerHTML='<span class="empty-inline">Choose a subject first</span>';updateCbkPreview();return;}
  const k=norm(sub),rows=[];
  Object.keys(cbkData).sort(clsSort).forEach(cls=>{
    const c=cbkData[cls],isC=c.compulsory.some(n=>norm(n)===k),isE=c.elective.some(n=>norm(n)===k);
    if(!isC&&!isE)return;
    const ex=cbkExisting.find(e=>(e.classId||e.className)===cls&&norm(e.name)===k);
    rows.push(`<label class="toggle-wrap" style="gap:8px"><input type="checkbox" value="${esc(cls)}" ${ex&&ex.teacherId?"":"checked"}><span><strong>${esc(cls)}</strong> <span style="color:var(--muted);font-size:.76rem">· ${isC?"compulsory":"elective"} · ${ex&&ex.teacherId?esc(ex.teacherName||"assigned"):"unassigned"}</span></span></label>`);
  });
  box.innerHTML=rows.join("")||'<span class="empty-inline">No class has this subject</span>';
  box.querySelectorAll("input").forEach(i=>i.addEventListener("change",updateCbkPreview));
  updateCbkPreview();
}
$("cbOpenBulkAssign").addEventListener("click",async()=>{
  classCache=null;
  const [cd,snap]=await Promise.all([getClassData(),getDocs(collection(db,"cbtSubjects")),loadTeacherList()]);
  cbkData=cd;cbkExisting=snap.docs.map(d=>({id:d.id,...d.data()}));
  await populateTeacherSel("cbkTeacher");
  const names=uniqNames(Object.values(cd).flatMap(c=>[...c.compulsory,...c.elective])).sort((a,b)=>a.localeCompare(b));
  $("cbkSubject").innerHTML='<option value="">— Select Subject —</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");
  $("cbkRepl").checked=false;buildCbkClasses();setupNewTeacher("cbkNewT","cbkTeacher");openMo("moCbBulk");
});
$("cbkSubject").addEventListener("change",buildCbkClasses);
$("cbkTeacher").addEventListener("change",updateCbkPreview);
$("cbkRepl").addEventListener("change",updateCbkPreview);
$("cbkAll").addEventListener("click",e=>{e.preventDefault();const bx=[...$("cbkClasses").querySelectorAll("input")];const all=bx.every(i=>i.checked);bx.forEach(i=>i.checked=!all);updateCbkPreview();});
$("cbkCancel").addEventListener("click",()=>closeMo("moCbBulk"));
$("cbkApply").addEventListener("click",async()=>{
  const tid=$("cbkTeacher").value,sub=$("cbkSubject").value,cl=cbkChecked(),btn=$("cbkApply");
  if(!tid||!sub||!cl.length){toast("Choose a teacher, a subject and at least one class.","error");return;}
  const todo=cl.map(k=>planAssign(k,sub,tid,$("cbkRepl").checked,cbkExisting)).filter(p=>p.act==="create"||p.act==="update");
  if(!todo.length){toast("Nothing to change for these classes.","error");return;}
  spin(btn,"Assigning...");
  try{
    const r=await applyPlans(todo,tid);
    toast(`${sub}: assigned in ${r.created+r.updated} class${r.created+r.updated===1?"":"es"}.`);
    closeMo("moCbBulk");loadSubjects();
  }catch(e){console.error(e);toast("Could not assign. Try again.","error");}
  finally{unspin(btn,"Assign");}
});

$("cbOpenSubject").addEventListener("click",async()=>{
  $("cbSubName").value=""; await populateClassSel("cbSubClass"); await populateTeacherSel("cbSubTeacher"); openMo("moCbSubject");
});
$("cbSubCancel").addEventListener("click",()=>closeMo("moCbSubject"));
$("cbSubSubmit").addEventListener("click",async()=>{
  const name=$("cbSubName").value.trim(), classId=$("cbSubClass").value, teacherId=$("cbSubTeacher").value, btn=$("cbSubSubmit");
  if(!name||!classId||!teacherId){toast("Please fill in all fields.","error");return;}
  spin(btn,"Saving...");
  try{
    const td=await getDoc(doc(db,"teachers",teacherId));
    await addDoc(collection(db,"cbtSubjects"),{name,classId,className:classId,teacherId,teacherName:td.data()?.name||"",createdAt:serverTimestamp()});
    toast(`Subject "${name}" created!`); closeMo("moCbSubject"); loadSubjects();
  }catch(e){toast("Failed to create subject.","error");}
  finally{unspin(btn,"Create Subject");}
});
async function openEditSubject(id,data){
  $("cbESubId").value=id; $("cbESubName").value=data.name||"";
  await populateClassSel("cbESubClass"); await populateTeacherSel("cbESubTeacher");
  $("cbESubClass").value=data.classId||""; $("cbESubTeacher").value=data.teacherId||"";
  openMo("moCbSubjectEdit");
}
$("cbESubCancel").addEventListener("click",()=>closeMo("moCbSubjectEdit"));
$("cbESubSave").addEventListener("click",()=>{
  closeMo("moCbSubjectEdit");
  requirePw("Save subject changes",async()=>{
    const id=$("cbESubId").value, name=$("cbESubName").value.trim(), classId=$("cbESubClass").value, teacherId=$("cbESubTeacher").value;
    if(!name||!classId||!teacherId){toast("Please fill in all fields.","error");return;}
    const td=await getDoc(doc(db,"teachers",teacherId));
    await updateDoc(doc(db,"cbtSubjects",id),{name,classId,className:classId,teacherId,teacherName:td.data()?.name||""});
    toast("Subject updated!"); loadSubjects();
  },"moCbSubjectEdit");
});

/* ============================================================
   CBT RESULTS  (collection: cbtResults)
   ============================================================ */
const AF=window.AF;
let cbResAll=null; // every cbtResults doc, read once per visit to the section (filters work on this copy)
async function ensureCbtResults(force){
  if(force||!cbResAll){
    const snap=await getDocs(collection(db,"cbtResults"));
    cbResAll=snap.docs.map(d=>({...d.data(),id:d.id}));
    AF.addSessions(cbResAll.map(r=>r.session));AF.refresh();
  }
  return cbResAll;
}
const rClass=r=>r.className||r.classId||"";
function cbtFiltered(key,extra){
  const f=AF.get(key);
  return (cbResAll||[]).filter(r=>{
    if(!AF.mSession(r.session,f.session))return false;
    if(!AF.mTerm(r.term,f.term))return false;
    if(f.cls&&rClass(r)!==f.cls&&r.classId!==f.cls)return false;
    if(f.subject&&norm(r.subjectName)!==norm(f.subject))return false;
    if(f.search&&!(r.studentName||"").toLowerCase().includes(f.search)&&!(r.regNumber||"").toLowerCase().includes(f.search))return false;
    return extra?extra(r):true;
  });
}
async function loadResults(force){
  const tbody=$("cbResBody");
  if(force||!cbResAll)tbody.innerHTML=loadingRow(6);
  try{await ensureCbtResults(force);}catch(e){console.error(e);tbody.innerHTML=emptyRow(6,"⚠️","Could not load CBT results. Please refresh.");return;}
  renderResults();
}
function renderResults(){
  if(!cbResAll)return;
  const tbody=$("cbResBody");
  const docs=cbtFiltered("cbres");
  docs.sort((a,b)=>(b.submittedAt?.toDate?.()?.getTime()||0)-(a.submittedAt?.toDate?.()?.getTime()||0));
  const pcts=docs.map(r=>r.totalMarks?(r.score/r.totalMarks)*100:0);
  AF.info("cbres",`Showing <strong>${docs.length}</strong> of ${cbResAll.length} CBT results`,AF.classSummary("cbres",pcts,{countLabel:"Attempts",unit:"%",dec:1}));
  if(!docs.length){tbody.innerHTML=`<tr><td colspan="6"><div class="empty">${AF.emptyHtml("cbres","CBT results")}</div></td></tr>`;return;}
  tbody.innerHTML="";
  docs.forEach(r=>{
    const pct=r.totalMarks?Math.round((r.score/r.totalMarks)*100):0;
    const cls=pct>=70?"b-green":pct>=50?"b-gold":"b-red";
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><strong>${esc(r.studentName||"—")}</strong><br/><span style="font-size:.75rem;color:var(--muted)">${esc(r.regNumber||"")} ${esc(r.className||"")}</span></td><td>${esc(r.examTitle||"—")}</td><td>${esc(r.subjectName||"—")}</td><td><span class="badge ${cls}">${r.score}/${r.totalMarks} (${pct}% · ${calcGrade(pct)})</span></td><td>${fmtDate(r.submittedAt)}</td><td></td>`;
    const del=document.createElement("button");del.className="btn btn-danger btn-sm";del.textContent="🗑️ Delete";
    del.addEventListener("click",()=>requirePw(`Delete result for "${r.studentName}"`,async()=>{await deleteDoc(doc(db,"cbtResults",r.id));toast("CBT result deleted.");loadResults(true);}));
    tr.cells[5].appendChild(del);tbody.appendChild(tr);
  });
}
$("cbResSend").addEventListener("click",()=>{const f=AF.get("cbres");if(window.openSendToResults)window.openSendToResults({session:f.session,term:f.term,cls:f.cls,subject:f.subject});});
$("cbResPrint").addEventListener("click",()=>{
  const w=window.open("","_blank");
  const rows=[...$("cbResBody").querySelectorAll("tr")].map(tr=>[...tr.cells].slice(0,5).map(c=>`<td style="border:1px solid #ccc;padding:6px 8px">${c.innerText}</td>`).join("")).map(r=>`<tr>${r}</tr>`).join("");
  w.document.write(`<html><head><title>CBT Results</title></head><body style="font-family:Arial,sans-serif"><h2>Newtown Academy — CBT Results</h2><p>${new Date().toDateString()}</p><table style="border-collapse:collapse;width:100%;font-size:13px"><tr><th style="border:1px solid #ccc;padding:6px">Student</th><th style="border:1px solid #ccc;padding:6px">Exam</th><th style="border:1px solid #ccc;padding:6px">Subject</th><th style="border:1px solid #ccc;padding:6px">Score</th><th style="border:1px solid #ccc;padding:6px">Date</th></tr>${rows}</table></body></html>`);
  w.document.close(); w.focus(); w.print();
});

/* ============================================================
   AI EXAM GENERATOR + MANUAL EXAM  (from the original CBT admin)
   ============================================================ */

// ─── AI EXAM GENERATOR ───
let generatedQuestions=[];

window.generateQuestions=async function(){
  const subject=document.getElementById("aiSubject").value;
  const topic=document.getElementById("aiTopic").value.trim();
  const count=parseInt(document.getElementById("aiCount").value)||40;
  const difficulty=document.getElementById("aiDifficulty").value;
  const style=document.getElementById("aiStyle").value;
  if(!subject){toast("Please select a subject","error");return;}
  if(!topic){toast("Please enter a topic or focus area","error");return;}
  const btn=document.getElementById("generateBtn");
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span> Generating...';
  document.getElementById("aiGenerating").style.display="block";
  document.getElementById("qPreviewWrap").style.display="none";
  document.getElementById("aiGenMsg").textContent=`AI is crafting ${count} ${difficulty} ${subject} questions on "${topic}"...`;

  const prompt=`You are an expert JAMB examination setter for Nigerian secondary school students. 
Generate exactly ${count} multiple-choice questions for ${subject}, focused on the topic: "${topic}".
Difficulty: ${difficulty}. Style: ${style}.
Requirements:
- Each question must be clearly worded in JAMB format
- Each question has exactly 4 options (A, B, C, D)
- One option is clearly correct
- Include a brief 1-sentence explanation for the correct answer
Respond ONLY with valid JSON in this exact format (no markdown, no preamble):
{
  "questions": [
    {
      "questionText": "The question text here",
      "options": {"a": "Option A text", "b": "Option B text", "c": "Option C text", "d": "Option D text"},
      "correctAnswer": "a",
      "explanation": "Brief explanation of why this is correct"
    }
  ]
}`;

  try{
    const aiKey=getAIKey();
    if(!aiKey)throw new Error("An OpenRouter API key is required.");
    const resp=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${aiKey}`},
      body:JSON.stringify({model:"deepseek/deepseek-r1",max_tokens:8000,messages:[{role:"user",content:prompt}]})
    });
    const data=await resp.json();
    if(data.error){ if(resp.status===401){try{localStorage.removeItem("cbt_ai_key");}catch(_){}} throw new Error(data.error.message||"API error"); }
    const text=data.choices?.[0]?.message?.content||"";
    const cleaned=text.replace(/```json/g,"").replace(/```/g,"").trim();
    const parsed=JSON.parse(cleaned);
    generatedQuestions=parsed.questions||[];
    if(!generatedQuestions.length)throw new Error("No questions generated. Try a different topic.");
    renderQPreview(subject,topic,count);
    toast(`✅ ${generatedQuestions.length} questions generated!`);
    document.getElementById("pubTitle").value=`${subject} — ${topic} (${difficulty})`;
    await populateClassSel("pubClass");
  }catch(err){
    console.error(err);toast(err.message||"Generation failed. Check your internet.","error");
  }finally{
    btn.disabled=false;btn.innerHTML='✨ Generate Questions';
    document.getElementById("aiGenerating").style.display="none";
  }
};

function renderQPreview(subject,topic,count){
  const list=document.getElementById("qPreviewList");
  document.getElementById("qPreviewTitle").textContent=`${generatedQuestions.length} Questions Generated — ${subject}: ${topic}`;
  list.innerHTML="";
  generatedQuestions.forEach((q,i)=>{
    const div=document.createElement("div");div.className="q-item";div.id=`qItem_${i}`;
    div.innerHTML=`
      <div class="q-item-top">
        <div class="q-num-badge">${i+1}</div>
        <textarea class="q-text-edit" data-qi="${i}" onchange="updateQ(${i},'questionText',this.value)">${q.questionText}</textarea>
        <button class="q-del-btn" onclick="deleteQ(${i})">✕ Remove</button>
      </div>
      <div class="q-opts">
        ${["a","b","c","d"].map(k=>`<div class="q-opt-row"><div class="q-opt-label">${k.toUpperCase()}</div><input class="q-opt-input" value="${q.options[k]||""}" onchange="updateQOpt(${i},'${k}',this.value)" placeholder="Option ${k.toUpperCase()}"></div>`).join("")}
      </div>
      <div class="q-correct-row">
        <label>Correct Answer:</label>
        <select class="q-correct-sel" onchange="updateQ(${i},'correctAnswer',this.value)">
          ${["a","b","c","d"].map(k=>`<option value="${k}" ${q.correctAnswer===k?"selected":""}>${k.toUpperCase()}</option>`).join("")}
        </select>
        <label style="margin-left:8px">Explanation:</label>
      </div>
      <textarea class="q-exp" placeholder="Brief explanation..." onchange="updateQ(${i},'explanation',this.value)">${q.explanation||""}</textarea>
    `;
    list.appendChild(div);
  });
  document.getElementById("qPreviewWrap").style.display="block";
}

window.updateQ=function(i,key,val){if(generatedQuestions[i])generatedQuestions[i][key]=val;};
window.updateQOpt=function(i,k,val){if(generatedQuestions[i]&&generatedQuestions[i].options)generatedQuestions[i].options[k]=val;};
window.deleteQ=function(i){generatedQuestions.splice(i,1);renderQPreview("","",generatedQuestions.length);toast("Question removed");};

window.publishExam=async function(){
  const btn=document.getElementById("publishBtn");
  const title=document.getElementById("pubTitle").value.trim();
  const classId=document.getElementById("pubClass").value;
  const duration=parseInt(document.getElementById("pubDuration").value)||60;
  const isActive=document.getElementById("pubActive").value==="true";
  const subject=document.getElementById("aiSubject").value;
  if(!title){toast("Please enter an exam title","error");return;}
  if(!classId){toast("Please assign to a class","error");return;}
  if(!generatedQuestions.length){toast("No questions to publish","error");return;}
  spin(btn,"Publishing...");
  try{
    const className=classId;
    const examRef=await addDoc(collection(db,"cbtExams"),{title,subjectName:subject,classId,className,duration,isActive,source:"ai",questionCount:generatedQuestions.length,
      session:$("pubSession").value,term:$("pubTerm").value,shuffleQuestions:$("pubShuffleQ").checked,shuffleOptions:$("pubShuffleO").checked,createdAt:serverTimestamp()});
    const t0=Date.now();
    for(let i=0;i<generatedQuestions.length;i++){
      const q=generatedQuestions[i];
      await addDoc(collection(db,"cbtQuestions"),{examId:examRef.id,questionText:q.questionText,options:q.options,correctAnswer:q.correctAnswer,explanation:q.explanation||"",imageUrl:"",order:t0+i,createdAt:serverTimestamp()});
    }
    toast(`🚀 Exam published with ${generatedQuestions.length} questions!`);
    document.getElementById("qPreviewWrap").style.display="none";generatedQuestions=[];
  }catch(err){console.error(err);toast("Publish failed","error");}
  finally{unspin(btn,"🚀 Publish Exam to CBT Hall");}
};

// ─── MANUAL EXAM ───
let meQuestions=[];
Object.defineProperty(window,"meQuestions",{get:()=>meQuestions,set:v=>{meQuestions=v;}});
window.renderMeQuestions=()=>renderMeQuestions();
function renderMeQuestions(){
  const list=document.getElementById("meQuestionsList");
  const empty=document.getElementById("meQEmpty");
  document.getElementById("meQCount").textContent=`(${meQuestions.length} added)`;
  if(!meQuestions.length){list.innerHTML="";empty.style.display="block";return;}
  empty.style.display="none";
  list.innerHTML=meQuestions.map((q,i)=>`
    <div style="border-bottom:1px solid var(--border);padding:14px 18px">
      <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
        <div style="background:var(--navy);color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0">${i+1}</div>
        <textarea style="flex:1;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:.84rem;resize:vertical;min-height:60px" placeholder="Question text..." oninput="meQuestions[${i}].questionText=this.value">${esc(q.questionText)}</textarea>
        <button onclick="meQuestions.splice(${i},1);renderMeQuestions()" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:.75rem;white-space:nowrap">✕ Remove</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        ${["a","b","c","d"].map(k=>`<div style="display:flex;align-items:center;gap:6px"><span style="font-size:.7rem;font-weight:700;background:#f1f5f9;padding:3px 8px;border-radius:4px">${k.toUpperCase()}</span><input style="flex:1;border:1px solid var(--border);border-radius:6px;padding:8px;font-size:.82rem;font-family:'DM Sans',sans-serif" value="${esc(q.options[k]||"")}" placeholder="Option ${k.toUpperCase()}" oninput="meQuestions[${i}].options['${k}']=this.value"></div>`).join("")}
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <label style="font-size:.78rem;font-weight:600;color:var(--muted)">Correct:</label>
        <select style="border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:.82rem" onchange="meQuestions[${i}].correctAnswer=this.value">
          ${["a","b","c","d"].map(k=>`<option value="${k}" ${q.correctAnswer===k?"selected":""}>${k.toUpperCase()}</option>`).join("")}
        </select>
      </div>
    </div>`).join("");
}

$("meClass").addEventListener("change",()=>fillSubjectSel("meSubject",$("meClass").value,""));
window.addMeQuestion=function(){
  meQuestions.push({questionText:"",options:{a:"",b:"",c:"",d:""},correctAnswer:"a"});
  renderMeQuestions();
};

function parseMeCSVText(raw){
  const lines=raw.trim().split("\n").map(l=>l.trim()).filter(Boolean);
  const results=[];
  for(const line of lines){
    if(line.toLowerCase().startsWith("question")||line.toLowerCase().startsWith("#"))continue;
    const cols=line.split(",").map(c=>c.trim());
    if(cols.length<6)continue;
    const[qt,a,b,c,d,ans]=cols;
    const correct=(ans||"a").toLowerCase().trim();
    results.push({questionText:qt,options:{a,b,c,d},correctAnswer:["a","b","c","d"].includes(correct)?correct:"a"});
  }
  return results;
}

window.handleMeCSVFile=function(){
  const file=document.getElementById("meCSVFile").files[0];if(!file)return;
  const reader=new FileReader();reader.onload=e=>{document.getElementById("meCSVPaste").value=e.target.result;};reader.readAsText(file);
};

// Numbered format:  1. Question / A. .. B. .. C. .. D. .. / Answer: B
function parseNumberedText(raw){
  const questions=[],strays=[],lines=raw.split(/\r?\n/).map(l=>l.trim());
  let cur=null;
  for(let li=0;li<lines.length;li++){
    const line=lines[li];
    if(!line)continue;
    const strict=line.match(/^(\d+)[\.\)]\s+(.+)/);
    const bare=!strict&&(!cur||cur.answer)?line.match(/^(\d+)\s+(.+)/):null;
    const qMatch=strict||bare;
    const ansMatch=line.match(/^(?:answer|ans)\s*[:\-]\s*([A-Da-d])\b/i);
    const optLine=line.match(/^([A-D])[\.\)]\s+\S/);
    const multiOpt=line.match(/\b[A-D][\.\)]\s+.+\b[A-D][\.\)]\s+/);
    if(qMatch&&!(cur&&!cur.answer&&optLine)){
      if(cur)questions.push(cur);
      cur={num:qMatch[1],line:li+1,text:qMatch[2].trim(),options:{},answer:"",errors:[]};
    }
    else if(!cur){strays.push({line:li+1,text:line});}
    else if(cur&&ansMatch){cur.answer=ansMatch[1].toLowerCase();}
    else if(cur&&(optLine||multiOpt)){
      const parts=line.split(/(?<!\w)(?=[A-D][\.\)]\s)/);
      parts.forEach(pt=>{const m=pt.match(/^([A-D])[\.\)]\s+(.+)/);if(m)cur.options[m[1].toLowerCase()]=m[2].trim();});
    }
    else if(cur&&!line.match(/^[A-D][\.\)]/i)&&!line.match(/^(?:answer|ans)\s*[:\-]/i)){cur.text+=" "+line;}
  }
  if(cur)questions.push(cur);
  questions.forEach(q=>{
    q.text=q.text.trim();
    if(!q.text)q.errors.push("missing question text");
    ["a","b","c","d"].forEach(k=>{if(!q.options[k])q.errors.push("missing option "+k.toUpperCase());});
    if(!q.answer)q.errors.push("missing answer line");
    else if(!q.options[q.answer])q.errors.push("answer "+q.answer.toUpperCase()+" is not an option");
  });
  questions.strays=strays;
  return questions;
}
// CSV rows with line numbers (a bad row is flagged instead of being silently guessed)
function parseMeCsvBlocks(raw){
  const ok=[],bad=[];
  raw.split(/\r?\n/).forEach((l0,i)=>{
    const line=l0.trim();if(!line)return;
    const low=line.toLowerCase();if(low.startsWith("question")||low.startsWith("#"))return;
    const cols=line.split(",").map(c=>c.trim());
    if(cols.length<6){bad.push({line:i+1,reason:`expected 6 comma-separated columns, found ${cols.length}`,text:line});return;}
    const[qt,a,b,c,d,ans]=cols,k=(ans||"").toLowerCase();
    if(!qt||!a||!b||!c||!d){bad.push({line:i+1,reason:"empty question or option",text:line});return;}
    if(!["a","b","c","d"].includes(k)){bad.push({line:i+1,reason:`answer "${ans||""}" must be A, B, C or D`,text:line});return;}
    ok.push({questionText:qt,options:{a,b,c,d},correctAnswer:k,line:i+1});
  });
  return{ok,bad};
}
let mePending=null;
const snip=t=>esc(String(t||"").slice(0,80))+(String(t||"").length>80?"…":"");
function renderMePreview(){
  const msg=document.getElementById("meImportMsg");if(!msg)return;
  if(!mePending){msg.style.display="none";return;}
  const{ok,bad,fmt}=mePending;
  msg.style.display="block";msg.style.color="var(--text,inherit)";
  let h=`<div><strong>${ok.length}</strong> question${ok.length===1?"":"s"} ready to import <span style="color:var(--muted)">(${fmt} format)</span>`+
    (bad.length?` · <strong style="color:var(--err)">${bad.length} block${bad.length===1?"":"s"} can’t be parsed</strong>`:` · nothing flagged ✅`)+`</div>`;
  if(bad.length)h+=`<ul style="margin:8px 0 0 18px;padding:0;font-size:.78rem;max-height:160px;overflow:auto">`+bad.map(b=>`<li style="margin-bottom:4px"><strong>Line ${b.line}:</strong> ${esc(b.reason)} — <code>${snip(b.text)}</code></li>`).join("")+`</ul>`;
  if(ok.length)h+=`<details style="margin-top:8px"><summary style="cursor:pointer;font-size:.78rem">Preview the ${ok.length} good question${ok.length===1?"":"s"}</summary><ol style="margin:6px 0 0 18px;padding:0;font-size:.76rem;max-height:160px;overflow:auto">`+ok.map(q=>`<li>${snip(q.questionText)} <span style="color:var(--muted)">(line ${q.line} · answer ${q.correctAnswer.toUpperCase()})</span></li>`).join("")+`</ol></details>`;
  h+=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn btn-p btn-sm" id="meImportOk" ${ok.length?"":"disabled"}>Import ${ok.length} valid question${ok.length===1?"":"s"}</button><button class="btn-cancel" id="meImportNo" style="flex:none;padding:7px 14px">Cancel</button></div>`+
    (bad.length?`<div style="margin-top:6px;font-size:.74rem;color:var(--muted)">Flagged blocks are left out. Fix them in the box and press Preview again, or import the good ones now.</div>`:"");
  msg.innerHTML=h;
  const okb=document.getElementById("meImportOk");if(okb)okb.onclick=()=>{
    meQuestions=[...meQuestions,...mePending.ok.map(q=>({questionText:q.questionText,options:q.options,correctAnswer:q.correctAnswer}))];
    renderMeQuestions();toast(`✅ Imported ${mePending.ok.length} question${mePending.ok.length===1?"":"s"}`+(mePending.bad.length?` (${mePending.bad.length} flagged left out)`:""));
    document.getElementById("meCSVPaste").value="";document.getElementById("meCSVFile").value="";mePending=null;renderMePreview();
  };
  document.getElementById("meImportNo").onclick=()=>{mePending=null;renderMePreview();};
}
window.parseMeCSV=function(){
  const raw=document.getElementById("meCSVPaste").value;
  if(!raw.trim()){toast("Paste questions or upload a file first","error");return;}
  const numbered=/^\s*\d+[\.\)]?\s+\S/m.test(raw)&&/^\s*(?:answer|ans)\s*[:\-]\s*[A-Da-d]/im.test(raw);
  let ok=[],bad=[],fmt;
  if(numbered){
    fmt="numbered";
    const qs=parseNumberedText(raw);
    qs.forEach(q=>{
      if(q.errors.length)bad.push({line:q.line,reason:q.errors.join(", "),text:`${q.num}. ${q.text}`});
      else ok.push({questionText:q.text,options:q.options,correctAnswer:q.answer,line:q.line});
    });
    (qs.strays||[]).forEach(x=>bad.push({line:x.line,reason:"text outside any numbered question",text:x.text}));
  }else{fmt="CSV";({ok,bad}=parseMeCsvBlocks(raw));}
  bad.sort((a,b)=>a.line-b.line);
  mePending={ok,bad,fmt};
  if(!ok.length&&!bad.length)toast("Nothing recognised. Check the format.","error");
  renderMePreview();
};

window.publishManualExam=async function(){
  const btn=document.getElementById("mePublishBtn");
  const title=document.getElementById("meTitle").value.trim();
  const classId=document.getElementById("meClass").value;
  const duration=parseInt(document.getElementById("meDuration").value)||60;
  const isActive=document.getElementById("meStatus").value==="true";
  if(!title){toast("Enter an exam title","error");return;}
  if(!classId){toast("Assign to a class","error");return;}
  if(!meQuestions.length){toast("Add at least one question","error");return;}
  const invalid=meQuestions.findIndex(q=>!q.questionText.trim());
  if(invalid!==-1){toast(`Question ${invalid+1} has no text`,"error");return;}
  spin(btn,"Publishing...");
  try{
    const className=classId;
    const examRef=await addDoc(collection(db,"cbtExams"),{title,subjectName:$("meSubject").value||"",classId,className,duration,isActive,source:"manual",type:"manual",questionCount:meQuestions.length,
      session:$("meSession").value,term:$("meTerm").value,shuffleQuestions:$("meShuffleQ").checked,shuffleOptions:$("meShuffleO").checked,createdAt:serverTimestamp()});
    const t0=Date.now();
    for(let i=0;i<meQuestions.length;i++){
      const q=meQuestions[i];
      await addDoc(collection(db,"cbtQuestions"),{examId:examRef.id,questionText:q.questionText,options:q.options,correctAnswer:q.correctAnswer,explanation:"",imageUrl:"",order:t0+i,createdAt:serverTimestamp()});
    }
    toast(`🚀 Manual exam published with ${meQuestions.length} questions!`);
    document.getElementById("meTitle").value="";document.getElementById("meClass").value="";document.getElementById("meDuration").value=60;fillSubjectSel("meSubject","","");
    meQuestions=[];renderMeQuestions();
  }catch(err){console.error(err);toast("Publish failed","error");}
  finally{unspin(btn,"🚀 Publish Manual Exam");}
};


// ─── EXAMS ───
let exAll=null, exQ={}, exTok=0;   // exam docs read once per visit; question counts cached
async function loadExams(force){
  const tbody=document.getElementById("exBody");
  if(force||!exAll)tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">Loading...</td></tr>`;
  if(force||!exAll){
    try{
      const snap=await getDocs(collection(db,"cbtExams"));
      exAll=snap.docs.map(d=>({...d.data(),id:d.id}));
      AF.addSessions(exAll.map(e=>e.session));AF.refresh();
    }catch(e){console.error(e);tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--err)">Could not load exams. Please refresh.</td></tr>`;return;}
  }
  renderExams();
}
async function renderExams(){
  if(!exAll)return;
  const tok=++exTok, tbody=document.getElementById("exBody"), f=AF.get("ex");
  let docs=exAll.filter(r=>{
    if(!AF.mSession(r.session,f.session))return false;
    if(!AF.mTerm(r.term,f.term))return false;
    if(f.cls&&r.classId!==f.cls&&r.className!==f.cls)return false;
    if(f.subject&&norm(r.subjectName)!==norm(f.subject))return false;
    if(f.status==="active"&&!r.isActive)return false;
    if(f.status==="draft"&&r.isActive)return false;
    if(f.search&&!(r.title||"").toLowerCase().includes(f.search)&&!(r.subjectName||"").toLowerCase().includes(f.search))return false;
    return true;
  });
  docs.sort((a,b)=>(b.createdAt?.toDate?.()?.getTime()||0)-(a.createdAt?.toDate?.()?.getTime()||0));
  const untaggedHidden=(f.session===AF.NONE||f.term===AF.NONE)?0:exAll.filter(r=>!r.session&&(f.session||f.term)).length;
  AF.info("ex",`Showing <strong>${docs.length}</strong> of ${exAll.length} exams`+(untaggedHidden?` · ${untaggedHidden} untagged exam${untaggedHidden===1?"":"s"} hidden by the session/term filter (choose “Untagged” or “All” to see them)`:""),
    AF.classSummary("ex",[],{countLabel:"Exams",count:docs.length}));
  if(!docs.length){tbody.innerHTML=`<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📝</div>${AF.emptyHtml("ex","exams")}</div></td></tr>`;return;}
  const missing=docs.filter(r=>r.questionCount==null&&exQ[r.id]==null);
  for(const r of missing){
    exQ[r.id]=(await getDocs(query(collection(db,"cbtQuestions"),where("examId","==",r.id)))).size;
    if(tok!==exTok)return;           // a newer filter change took over
  }
  tbody.innerHTML="";
  for(const r of docs){
    const qCount=r.questionCount!=null?r.questionCount:(exQ[r.id]||0);
    const tr=document.createElement("tr");
    const tag=r.session?`${esc(r.session)} · ${esc(r.term||"")} Term`:"Untagged session/term";
    tr.innerHTML=`<td><strong>${esc(r.title)}</strong><br><span style="font-size:.72rem;color:var(--muted)">${tag}</span></td><td>${esc(r.subjectName||"—")}</td><td><span class="badge b-gold">${esc(r.className||"—")}</span></td><td>${qCount}</td><td>${r.duration} min</td><td><span class="badge ${r.isActive?"b-green":"b-purple"}">${r.isActive?"🟢 Active":"⚫ Draft"}</span></td><td><span class="badge ${r.source==="ai"?"b-ai":"b-purple"}">${r.source==="ai"?"🤖 AI":"✏️ Manual"}</span></td><td></td>`;
    const tBtn=document.createElement("button");tBtn.className="btn btn-edit btn-sm";tBtn.textContent=r.isActive?"⏸ Deactivate":"▶ Activate";
    tBtn.onclick=async()=>{await updateDoc(doc(db,"cbtExams",r.id),{isActive:!r.isActive});r.isActive=!r.isActive;toast("Exam updated!");renderExams();};
    const sBtn=document.createElement("button");sBtn.className="btn btn-edit btn-sm";sBtn.textContent="⚙ Settings";sBtn.onclick=()=>openExamSettings(r.id,r);
    const rBtn=document.createElement("button");rBtn.className="btn btn-edit btn-sm";rBtn.textContent="📤 Results";rBtn.onclick=()=>{if(window.openSendToResults)window.openSendToResults({examId:r.id,session:r.session,term:r.term,cls:r.classId||r.className,subject:r.subjectName});};
    const dBtn=document.createElement("button");dBtn.className="btn btn-danger btn-sm";dBtn.textContent="🗑️";
    dBtn.onclick=async()=>{if(!confirm("Delete this exam and all its questions?"))return;const qs=await getDocs(query(collection(db,"cbtQuestions"),where("examId","==",r.id)));for(const q of qs.docs)await deleteDoc(doc(db,"cbtQuestions",q.id));await deleteDoc(doc(db,"cbtExams",r.id));exAll=exAll.filter(x=>x.id!==r.id);toast("Exam deleted");renderExams();};
    const div=document.createElement("div");div.className="act-btns";div.appendChild(sBtn);div.appendChild(rBtn);div.appendChild(tBtn);div.appendChild(dBtn);
    tr.cells[7].appendChild(div);tbody.appendChild(tr);
  }
}

// ─── EXAM SETTINGS (subject, session, term, shuffling) ───
async function openExamSettings(id,r){
  $("cesId").value=id;$("cesClass").value=r.classId||"";
  $("cesTitle").textContent=`${r.title||"Exam"} · ${r.className||"no class"}`;
  await Promise.all([fillSubjectSel("cesSubject",r.classId||"",r.subjectName||""),fillAcademic("cesSession","cesTerm",r.session||"",r.term||"")]);
  $("cesShuffleQ").checked=r.shuffleQuestions!==false;
  $("cesShuffleO").checked=r.shuffleOptions!==false;
  openMo("moCbExamSet");
}
$("cesCancel").addEventListener("click",()=>closeMo("moCbExamSet"));
$("cesSave").addEventListener("click",async()=>{
  const btn=$("cesSave");spin(btn,"Saving...");
  try{
    await updateDoc(doc(db,"cbtExams",$("cesId").value),{subjectName:$("cesSubject").value||"",session:$("cesSession").value,term:$("cesTerm").value,shuffleQuestions:$("cesShuffleQ").checked,shuffleOptions:$("cesShuffleO").checked});
    toast("Exam settings saved.");closeMo("moCbExamSet");loadExams(true);
  }catch(e){console.error(e);toast("Could not save settings.","error");}
  finally{unspin(btn,"Save");}
});

// ─── LEADERBOARD ───
async function loadLeaderboard(force){
  const el=document.getElementById("lbContent");
  if(force||!cbResAll)el.innerHTML='<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading...</p></div>';
  try{await ensureCbtResults(force);}catch(e){console.error(e);el.innerHTML='<div class="empty-state"><div class="empty-icon">⚠️</div><p>Could not load the leaderboard. Please refresh.</p></div>';return;}
  renderLeaderboard();
}
function renderLeaderboard(){
  if(!cbResAll)return;
  const period=document.getElementById("lbPeriod").value;
  const el=document.getElementById("lbContent"),now=Date.now();
  const docs=cbtFiltered("lb",r=>{
    if(period==="all")return true;
    const t=r.submittedAt?.toDate?.()?.getTime()||0;
    return t>=now-(period==="week"?7:30)*24*3600*1000;
  });
  const scores={};docs.forEach(r=>{if(!scores[r.studentId])scores[r.studentId]={name:r.studentName,total:0,count:0};scores[r.studentId].total+=r.percentage||0;scores[r.studentId].count++;});
  const ranked=Object.entries(scores).map(([id,x])=>({id,...x,avg:Math.round(x.total/x.count)})).sort((a,b)=>b.avg-a.avg);
  AF.info("lb",`<strong>${ranked.length}</strong> student${ranked.length===1?"":"s"} ranked from ${docs.length} attempt${docs.length===1?"":"s"}`,
    AF.classSummary("lb",ranked.map(x=>x.avg),{countLabel:"Students",unit:"%",dec:1}));
  if(!ranked.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">🏆</div>${AF.emptyHtml("lb","leaderboard data ("+(period==="week"?"this week":period==="month"?"this month":"all time")+")")}</div>`;return;}
  el.innerHTML=`<div class="lb-card"><div class="lb-header"><h4>${period==="week"?"📅 This Week":period==="month"?"📆 This Month":"🏆 All Time"}</h4></div>${ranked.map((x,i)=>`<div class="lb-entry"><div class="lb-rank ${i===0?"rank-1":i===1?"rank-2":i===2?"rank-3":"rank-other"}">${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</div><div class="lb-name">${esc(x.name)}</div><div class="lb-score">${x.avg}%</div></div>`).join("")}</div>`;
}

$("lbPeriod").addEventListener("change",renderLeaderboard);

/* ---------- filter bars (shared AF module from admin.html) ---------- */
const subjFrom=list=>()=>(list()||[]).map(r=>r.subjectName).filter(Boolean);
AF.mount("cbres","afCbRes",{section:"cbtResults",fields:["session","term","class","subject","search"],untagged:true,subjects:subjFrom(()=>cbResAll),searchPlaceholder:"Student name or reg number…",onChange:renderResults});
AF.mount("ex","afEx",{section:"cbtExams",fields:["session","term","class","subject","status","search"],untagged:true,statuses:[["active","Active"],["draft","Draft"]],subjects:subjFrom(()=>exAll),searchPlaceholder:"Exam title or subject…",onChange:renderExams});
AF.mount("lb","afBoard",{section:"cbtBoard",fields:["session","term","class","subject"],untagged:true,subjects:subjFrom(()=>cbResAll),onChange:renderLeaderboard});
