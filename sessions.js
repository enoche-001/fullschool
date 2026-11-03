/* Session dropdowns (admin, teacher, student pages).
   - Every <select> whose id contains "sess" (and has no "All sessions" blank option) becomes a dropdown with
     2 past sessions, the current one, and 9 future ones, plus "Other (type manually)…" at the bottom.
   - Choosing "Other" shows a small box: type 2031/2032 (or just 2031) and press Enter.
   - A session typed once stays in that dropdown until the page reloads, and any code that sets
     select.value = "2040/2041" also works (the option is added automatically).
   - window.SESSIONS = the generated list, for pages that build their own selects.
   Nothing here needs internet. Nothing is stored; saved data keeps the session text as before. */
(function () {
  var now = new Date();
  var start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;   // sessions start in September
  var list = [];
  for (var y = start - 2; y <= start + 9; y++) list.push(y + "/" + (y + 1));
  window.SESSIONS = list;

  var OTHER = "__other__", RX = /^(\d{4})\/(\d{4})$/;
  var proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

  function isSess(s) {
    if (!s || s.tagName !== "SELECT" || !/sess/i.test(s.id || "")) return false;
    return ![].some.call(s.options, function (o) { return o.value === ""; });   // skip filter bars ("All sessions")
  }
  function has(s, v) { return [].some.call(s.options, function (o) { return o.value === v; }); }
  function raw(s) { return proto.get.call(s); }

  function render(s, want) {
    if (s.__busy) return; s.__busy = true;
    var cur = want != null ? want : raw(s);
    if (cur === OTHER) cur = s.__prev || "";
    var set = {}; list.forEach(function (x) { set[x] = 1; });
    [].forEach.call(s.options, function (o) { if (RX.test(o.value)) set[o.value] = 1; });
    if (cur && RX.test(cur)) set[cur] = 1;
    var all = Object.keys(set).sort();
    s.innerHTML = all.map(function (x) { return '<option value="' + x + '">' + x + "</option>"; }).join("") +
      '<option value="' + OTHER + '">Other (type manually)…</option>';
    proto.set.call(s, cur && has(s, cur) ? cur : (all.indexOf(list[2]) >= 0 ? list[2] : all[0]));
    s.__busy = false;
  }

  function normalise(t) {
    t = String(t || "").trim().replace(/\s+/g, "");
    var m;
    if ((m = t.match(/^(\d{4})$/))) return m[1] + "/" + (+m[1] + 1);
    if ((m = t.match(/^(\d{4})\D+(\d{2})$/))) return m[1] + "/" + (m[1].slice(0, 2) + m[2]);
    if ((m = t.match(/^(\d{4})\D+(\d{4})$/))) return m[1] + "/" + m[2];
    return "";
  }

  function askManual(s) {
    var prev = s.__prev || list[2];
    var box = document.createElement("input");
    box.type = "text"; box.maxLength = 9; box.placeholder = "e.g. 2031/2032  then Enter";
    box.setAttribute("autocomplete", "off");
    box.style.cssText = "width:100%;box-sizing:border-box;padding:" + (getComputedStyle(s).padding || "9px") + ";font:inherit;border:1.5px solid #b8902a;border-radius:8px";
    s.style.display = "none"; s.parentNode.insertBefore(box, s.nextSibling);
    var done = false;
    function close(v) {
      if (done) return; done = true;
      box.remove(); s.style.display = "";
      if (v) { var had = has(s, v); if (!had) render(s, v); else proto.set.call(s, v); s.__prev = v; s.dispatchEvent(new Event("change", { bubbles: true })); }
      else render(s, prev);
    }
    function commit() {
      var v = normalise(box.value), m = v.match(RX);
      if (!v || !m || +m[2] !== +m[1] + 1) { box.style.borderColor = "#dc2626"; box.title = "Use the form 2031/2032"; return false; }
      close(v); return true;
    }
    box.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); close(null); }
    });
    box.addEventListener("blur", function () { if (!box.value.trim()) close(null); else if (!commit()) close(null); });
    box.focus();
  }

  function upgrade(s) {
    if (s.__sess || !isSess(s)) return;
    s.__sess = true; s.__prev = raw(s) || list[2];
    // select.value = "2040/2041" from other code adds the option instead of silently clearing the select
    Object.defineProperty(s, "value", {
      configurable: true,
      get: function () { var v = raw(s); return v === OTHER ? "" : v; },
      set: function (v) { v = String(v == null ? "" : v); if (v && v !== OTHER && RX.test(v) && !has(s, v)) render(s, v); proto.set.call(s, v); s.__prev = raw(s) === OTHER ? s.__prev : raw(s); }
    });
    s.addEventListener("focus", function () { var v = raw(s); if (v !== OTHER) s.__prev = v; });
    s.addEventListener("change", function (e) {
      if (raw(s) === OTHER) { e.stopImmediatePropagation(); askManual(s); } else s.__prev = raw(s);
    }, true);                                              // capture: runs before the page's own change handlers
    render(s);
    // if the page rebuilds the options later (innerHTML = ...), put "Other" and the long list back
    new MutationObserver(function () { if (!s.__busy && !has(s, OTHER)) render(s); }).observe(s, { childList: true });
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.tagName === "SELECT") upgrade(root);
    [].forEach.call(root.querySelectorAll ? root.querySelectorAll("select") : [], upgrade);
  }
  function init() {
    scan(document.documentElement);
    new MutationObserver(function (ms) { ms.forEach(function (m) { [].forEach.call(m.addedNodes, scan); }); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
  init();                                                       // start right away so selects are upgraded as the page is parsed
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(document.documentElement); });
})();
