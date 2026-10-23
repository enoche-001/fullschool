/* ============================================================
   CBT ADMIN — merged into the school admin portal
   Sections: Teachers, Subjects, AI Exam Generator, Manual Exam,
   Manage Exams, CBT Results, Leaderboard
   Data lives in the school Firebase project (veil-1-bd7b5):
   teachers, cbtSubjects, cbtExams, cbtQuestions, cbtResults
   ============================================================ */
import { getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, deleteField, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = getApp();                 // same Firebase app the admin page already created
const auth = getAuth(app);
const db = getFirestore(app);
// Secondary app: used ONLY to create/delete teacher logins so the admin stays signed in
const secApp = initializeApp(app.options, "cbt-secondary");
const secAuth = getAuth(secApp);

const CLASSES = ['JSS1','JSS2','JSS3','SS1','SS2','SS3'];
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
  CLASSES.forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;sel.appendChild(o);});
}
async function populateTeacherSel(selId){
  const sel=$(selId);
  sel.innerHTML='<option value="">— Select Teacher —</option>';
  const snap=await getDocs(collection(db,"teachers"));
  snap.docs.sort((a,b)=>(a.data().name||"").localeCompare(b.data().name||"")).forEach(d=>{const o=document.createElement("option");o.value=d.id;o.textContent=d.data().name;sel.appendChild(o);});
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
document.querySelectorAll("#moCbTeacher,#moCbTeacherEdit,#moCbSubject,#moCbSubjectEdit,#moCbPw").forEach(ov=>ov.addEventListener("click",e=>{if(e.target===ov)ov.classList.remove("open");}));

/* ---------- nav hook: load data when a CBT section opens ---------- */
const LOADERS={
  cbtTeachers:()=>loadTeachers(),
  cbtSubjects:()=>loadSubjects(),
  cbtAI:()=>populateClassSel("pubClass"),
  cbtManual:()=>populateClassSel("meClass"),
  cbtExams:()=>{populateClassSel("exClassFilter");loadExams();},
  cbtResults:()=>loadResults(),
  cbtBoard:()=>{populateClassSel("lbClass");loadLeaderboard();},
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
    let m="Failed to create teacher.";
    if(err.code==="auth/email-already-in-use")m="That email is already in use.";
    if(err.code==="auth/weak-password")m="Password is too weak.";
    toast(m,"error"); unspin(btn,"Create Teacher");
  }
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
async function loadSubjects(){
  const tbody=$("cbSubjectsBody");
  tbody.innerHTML=loadingRow(5);
  const snap=await getDocs(collection(db,"cbtSubjects"));
  if(snap.empty){tbody.innerHTML=emptyRow(5,"📚","No subjects yet — create teachers first, then assign subjects");return;}
  tbody.innerHTML="";
  snap.docs.sort((a,b)=>(a.data().className||"").localeCompare(b.data().className||"")||(a.data().name||"").localeCompare(b.data().name||"")).forEach(d=>{
    const s=d.data();
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><strong>${esc(s.name||"—")}</strong></td><td><span class="badge b-gold">${esc(s.className||"—")}</span></td><td>${esc(s.teacherName||"—")}</td><td>${fmtDate(s.createdAt)}</td><td></td>`;
    const edit=document.createElement("button");edit.className="btn btn-edit btn-sm";edit.textContent="✏️ Edit";
    edit.addEventListener("click",()=>openEditSubject(d.id,s));
    const del=document.createElement("button");del.className="btn btn-danger btn-sm";del.textContent="🗑️ Delete";
    del.addEventListener("click",()=>requirePw(`Delete subject "${s.name}"`,async()=>{await deleteDoc(doc(db,"cbtSubjects",d.id));toast(`Subject "${s.name}" deleted.`);loadSubjects();}));
    const div=document.createElement("div");div.className="act-btns";div.appendChild(edit);div.appendChild(del);
    tr.cells[4].appendChild(div);tbody.appendChild(tr);
  });
}
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
async function loadResults(){
  const tbody=$("cbResBody");
  tbody.innerHTML=loadingRow(6);
  const snap=await getDocs(collection(db,"cbtResults"));
  const rs=($("cbResSearch").value||"").toLowerCase(), rc=$("cbResClass").value;
  let docs=snap.docs.filter(d=>{const r=d.data();
    if(rs&&!(r.studentName||"").toLowerCase().includes(rs)&&!(r.regNumber||"").toLowerCase().includes(rs))return false;
    if(rc&&r.className!==rc)return false; return true;});
  docs.sort((a,b)=>(b.data().submittedAt?.toDate?.()?.getTime()||0)-(a.data().submittedAt?.toDate?.()?.getTime()||0));
  if(!docs.length){tbody.innerHTML=emptyRow(6,"📊","No CBT results yet");return;}
  tbody.innerHTML="";
  docs.forEach(d=>{
    const r=d.data(), pct=r.totalMarks?Math.round((r.score/r.totalMarks)*100):0;
    const cls=pct>=70?"b-green":pct>=50?"b-gold":"b-red";
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><strong>${esc(r.studentName||"—")}</strong><br/><span style="font-size:.75rem;color:var(--muted)">${esc(r.regNumber||"")} ${esc(r.className||"")}</span></td><td>${esc(r.examTitle||"—")}</td><td>${esc(r.subjectName||"—")}</td><td><span class="badge ${cls}">${r.score}/${r.totalMarks} (${pct}% · ${calcGrade(pct)})</span></td><td>${fmtDate(r.submittedAt)}</td><td></td>`;
    const del=document.createElement("button");del.className="btn btn-danger btn-sm";del.textContent="🗑️ Delete";
    del.addEventListener("click",()=>requirePw(`Delete result for "${r.studentName}"`,async()=>{await deleteDoc(doc(db,"cbtResults",d.id));toast("CBT result deleted.");loadResults();}));
    tr.cells[5].appendChild(del);tbody.appendChild(tr);
  });
}
$("cbResSearch").addEventListener("input",loadResults);
$("cbResClass").addEventListener("change",loadResults);
$("cbResPrint").addEventListener("click",()=>{
  const w=window.open("","_blank");
  const rows=[...$("cbResBody").querySelectorAll("tr")].map(tr=>[...tr.cells].slice(0,5).map(c=>`<td style="border:1px solid #ccc;padding:6px 8px">${c.innerText}</td>`).join("")).map(r=>`<tr>${r}</tr>`).join("");
  w.document.write(`<html><head><title>CBT Results</title></head><body style="font-family:Arial,sans-serif"><h2>Brighton Heights School — CBT Results</h2><p>${new Date().toDateString()}</p><table style="border-collapse:collapse;width:100%;font-size:13px"><tr><th style="border:1px solid #ccc;padding:6px">Student</th><th style="border:1px solid #ccc;padding:6px">Exam</th><th style="border:1px solid #ccc;padding:6px">Subject</th><th style="border:1px solid #ccc;padding:6px">Score</th><th style="border:1px solid #ccc;padding:6px">Date</th></tr>${rows}</table></body></html>`);
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
    const examRef=await addDoc(collection(db,"cbtExams"),{title,subjectName:subject,classId,className,duration,isActive,source:"ai",questionCount:generatedQuestions.length,createdAt:serverTimestamp()});
    for(const q of generatedQuestions){
      await addDoc(collection(db,"cbtQuestions"),{examId:examRef.id,questionText:q.questionText,options:q.options,correctAnswer:q.correctAnswer,explanation:q.explanation||"",imageUrl:"",createdAt:serverTimestamp()});
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
        <textarea style="flex:1;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:.84rem;resize:vertical;min-height:60px" placeholder="Question text..." oninput="meQuestions[${i}].questionText=this.value">${q.questionText}</textarea>
        <button onclick="meQuestions.splice(${i},1);renderMeQuestions()" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:.75rem;white-space:nowrap">✕ Remove</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        ${["a","b","c","d"].map(k=>`<div style="display:flex;align-items:center;gap:6px"><span style="font-size:.7rem;font-weight:700;background:#f1f5f9;padding:3px 8px;border-radius:4px">${k.toUpperCase()}</span><input style="flex:1;border:1px solid var(--border);border-radius:6px;padding:8px;font-size:.82rem;font-family:'DM Sans',sans-serif" value="${q.options[k]||""}" placeholder="Option ${k.toUpperCase()}" oninput="meQuestions[${i}].options['${k}']=this.value"></div>`).join("")}
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <label style="font-size:.78rem;font-weight:600;color:var(--muted)">Correct:</label>
        <select style="border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:.82rem" onchange="meQuestions[${i}].correctAnswer=this.value">
          ${["a","b","c","d"].map(k=>`<option value="${k}" ${q.correctAnswer===k?"selected":""}>${k.toUpperCase()}</option>`).join("")}
        </select>
      </div>
    </div>`).join("");
}

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

window.parseMeCSV=function(){
  const raw=document.getElementById("meCSVPaste").value;
  if(!raw.trim()){toast("Paste CSV text or upload a file first","error");return;}
  const imported=parseMeCSVText(raw);
  if(!imported.length){toast("No valid rows found. Check the format.","error");return;}
  meQuestions=[...meQuestions,...imported];
  renderMeQuestions();toast(`✅ Imported ${imported.length} questions!`);
  document.getElementById("meCSVPaste").value="";document.getElementById("meCSVFile").value="";
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
    const examRef=await addDoc(collection(db,"cbtExams"),{title,classId,className,duration,isActive,source:"manual",type:"manual",questionCount:meQuestions.length,createdAt:serverTimestamp()});
    for(const q of meQuestions){
      await addDoc(collection(db,"cbtQuestions"),{examId:examRef.id,questionText:q.questionText,options:q.options,correctAnswer:q.correctAnswer,explanation:"",imageUrl:"",createdAt:serverTimestamp()});
    }
    toast(`🚀 Manual exam published with ${meQuestions.length} questions!`);
    document.getElementById("meTitle").value="";document.getElementById("meClass").value="";document.getElementById("meDuration").value=60;
    meQuestions=[];renderMeQuestions();
  }catch(err){console.error(err);toast("Publish failed","error");}
  finally{unspin(btn,"🚀 Publish Manual Exam");}
};


// ─── EXAMS ───
async function loadExams(){
  const tbody=document.getElementById("exBody");
  tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">Loading...</td></tr>`;
  const search=(document.getElementById("exSearch").value||"").toLowerCase();
  const classF=document.getElementById("exClassFilter").value;
  let snap=await getDocs(collection(db,"cbtExams"));
  let docs=snap.docs;
  if(search)docs=docs.filter(d=>(d.data().title||"").toLowerCase().includes(search));
  if(classF)docs=docs.filter(d=>d.data().classId===classF);
  docs.sort((a,b)=>(b.data().createdAt?.toDate?.()?.getTime()||0)-(a.data().createdAt?.toDate?.()?.getTime()||0));
  if(!docs.length){tbody.innerHTML=`<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📝</div><p>No exams yet</p></div></td></tr>`;return;}
  tbody.innerHTML="";
  for(const d of docs){
    const r=d.data();
    const qCount=r.questionCount||(await getDocs(query(collection(db,"cbtQuestions"),where("examId","==",d.id)))).size;
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><strong>${r.title}</strong></td><td>${r.subjectName||"—"}</td><td><span class="badge b-gold">${r.className||"—"}</span></td><td>${qCount}</td><td>${r.duration} min</td><td><span class="badge ${r.isActive?"b-green":"b-purple"}">${r.isActive?"🟢 Active":"⚫ Draft"}</span></td><td><span class="badge ${r.source==="ai"?"b-ai":"b-purple"}">${r.source==="ai"?"🤖 AI":"✏️ Manual"}</span></td><td></td>`;
    const tBtn=document.createElement("button");tBtn.className="btn btn-edit btn-sm";tBtn.textContent=r.isActive?"⏸ Deactivate":"▶ Activate";
    tBtn.onclick=async()=>{await updateDoc(doc(db,"cbtExams",d.id),{isActive:!r.isActive});toast("Exam updated!");loadExams();};
    const dBtn=document.createElement("button");dBtn.className="btn btn-danger btn-sm";dBtn.textContent="🗑️";
    dBtn.onclick=async()=>{if(!confirm("Delete this exam and all its questions?"))return;const qs=await getDocs(query(collection(db,"cbtQuestions"),where("examId","==",d.id)));for(const q of qs.docs)await deleteDoc(doc(db,"cbtQuestions",q.id));await deleteDoc(doc(db,"cbtExams",d.id));toast("Exam deleted");loadExams();};
    const div=document.createElement("div");div.className="act-btns";div.appendChild(tBtn);div.appendChild(dBtn);
    tr.cells[7].appendChild(div);tbody.appendChild(tr);
  }
}
document.getElementById("exSearch").addEventListener("input",loadExams);
document.getElementById("exClassFilter").addEventListener("change",loadExams);

// ─── LEADERBOARD ───
async function loadLeaderboard(){
  const period=document.getElementById("lbPeriod").value;
  const classF=document.getElementById("lbClass").value;
  const el=document.getElementById("lbContent");
  el.innerHTML='<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading...</p></div>';
  try{
    let snap;
    if(classF){snap=await getDocs(query(collection(db,"cbtResults"),where("classId","==",classF)));}
    else{snap=await getDocs(collection(db,"cbtResults"));}
    let docs=snap.docs;const now=Date.now();
    if(period==="week")docs=docs.filter(d=>{const t=d.data().submittedAt?.toDate?.()?.getTime()||0;return t>=now-7*24*3600*1000;});
    else if(period==="month")docs=docs.filter(d=>{const t=d.data().submittedAt?.toDate?.()?.getTime()||0;return t>=now-30*24*3600*1000;});
    const scores={};docs.forEach(d=>{const r=d.data();if(!scores[r.studentId])scores[r.studentId]={name:r.studentName,total:0,count:0};scores[r.studentId].total+=r.percentage||0;scores[r.studentId].count++;});
    const ranked=Object.entries(scores).map(([id,s])=>({id,...s,avg:Math.round(s.total/s.count)})).sort((a,b)=>b.avg-a.avg);
    if(!ranked.length){el.innerHTML='<div class="empty-state"><div class="empty-icon">🏆</div><p>No data for this period</p></div>';return;}
    el.innerHTML=`<div class="lb-card"><div class="lb-header"><h4>${period==="week"?"📅 This Week":period==="month"?"📆 This Month":"🏆 All Time"}</h4></div>${ranked.map((s,i)=>`<div class="lb-entry"><div class="lb-rank ${i===0?"rank-1":i===1?"rank-2":i===2?"rank-3":"rank-other"}">${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</div><div class="lb-name">${s.name}</div><div class="lb-score">${s.avg}%</div></div>`).join("")}</div>`;
  }catch(e){console.error(e);}
}

$("lbPeriod").addEventListener("change",loadLeaderboard);
$("lbClass").addEventListener("change",loadLeaderboard);
