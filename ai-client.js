/* Shared AI helpers (admin, teacher, student pages).
   - generate(): calls the school's server (/api/ai-generate) which talks to OpenRouter.
     No AI key lives in the browser any more.
   - extractText(): reads PDF / Word (.docx) / text files in the browser (nothing is uploaded anywhere).
   - safeSvg(): rebuilds a diagram from a strict whitelist so a drawing can never run code. */
export const AI_ENDPOINT = "https://fullschoolapi.vercel.app/api/ai-generate";

export async function generate(auth, payload){
  const u = auth.currentUser;
  if(!u) throw new Error("Please sign in again.");
  const token = await u.getIdToken();
  let r;
  try{
    r = await fetch(AI_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(payload)});
  }catch(e){ throw new Error("Could not reach the AI server. Check your internet."); }
  let d={}; try{ d = await r.json(); }catch(e){}
  if(!r.ok || !d.ok) throw new Error(d.message || ("AI error ("+r.status+")"));
  return d.questions || [];
}

function loadScript(src){
  return new Promise((res,rej)=>{
    if(document.querySelector('script[data-src="'+src+'"]')) return res();
    const s=document.createElement("script"); s.src=src; s.dataset.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error("Could not load a file reader. Check your internet."));
    document.head.appendChild(s);
  });
}
export async function extractText(file){
  const name=(file.name||"").toLowerCase();
  if(/\.(txt|md|csv)$/.test(name) || file.type.startsWith("text/")) return await file.text();
  if(name.endsWith(".docx")){
    await loadScript("https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js");
    const r = await window.mammoth.extractRawText({arrayBuffer: await file.arrayBuffer()});
    return r.value || "";
  }
  if(name.endsWith(".pdf")){
    await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js");
    const lib=window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    const pdf = await lib.getDocument({data: await file.arrayBuffer()}).promise;
    let out="";
    for(let i=1;i<=pdf.numPages && out.length<60000;i++){
      const pg=await pdf.getPage(i), tc=await pg.getTextContent();
      out += tc.items.map(x=>x.str).join(" ")+"\n\n";
    }
    return out;
  }
  throw new Error('"'+file.name+'" is not supported. Use PDF, Word (.docx) or text files.');
}

const OK_TAGS=new Set(["svg","g","line","polyline","polygon","rect","circle","ellipse","path","text","tspan","defs","marker"]);
const OK_ATTR=new Set(["viewbox","width","height","x","y","x1","y1","x2","y2","cx","cy","r","rx","ry","points","d","fill","stroke","stroke-width","stroke-dasharray","stroke-linecap","stroke-linejoin","font-size","font-family","font-weight","font-style","text-anchor","dominant-baseline","transform","opacity","fill-opacity","id","marker-end","marker-start","markerwidth","markerheight","refx","refy","orient","dx","dy","xmlns"]);
export function safeSvg(src){
  if(typeof src!=="string"||!/^\s*<svg[\s>]/i.test(src)||src.length>8000) return "";
  let doc; try{ doc=new DOMParser().parseFromString(src.includes("xmlns")?src:src.replace(/^\s*<svg/i,'<svg xmlns="http://www.w3.org/2000/svg"'),"image/svg+xml"); }catch(e){return "";}
  if(doc.querySelector("parsererror")||!doc.documentElement||doc.documentElement.nodeName!=="svg") return "";
  const walk=(el)=>{
    [...el.children].forEach(ch=>{ if(!OK_TAGS.has(ch.nodeName)){ ch.remove(); } else walk(ch); });
    [...el.attributes].forEach(a=>{
      const n=a.name.toLowerCase(), v=a.value;
      if(!OK_ATTR.has(n) || /javascript:|data:|<|&#/i.test(v) || (/url\(/i.test(v) && !/^url\(#[\w-]+\)$/.test(v))) el.removeAttribute(a.name);
    });
  };
  walk(doc.documentElement);
  const svg=doc.documentElement; svg.removeAttribute("width"); svg.removeAttribute("height");
  if(!svg.getAttribute("viewBox")) svg.setAttribute("viewBox","0 0 300 200");
  return new XMLSerializer().serializeToString(svg);
}
