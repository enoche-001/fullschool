/* Always-visible scroll indicators.
   Phones hide scrollbars a second after you stop scrolling, so people miss that a page,
   a form, a results table or a popup continues. This draws slim bars that stay on screen
   for EVERY area that can scroll: the page, the main panel, popups, tables (sideways too),
   lists and text boxes.
   Where the device already shows a real scrollbar (most desktops), nothing extra is drawn,
   so you never see a double bar. */
(function () {
  if (window.__scrollIndicator) return;
  window.__scrollIndicator = true;

  // Elements in this project that scroll by themselves (taken from the CSS), plus anything with an inline overflow style.
  var SEL = '.content,.mbox,.modal,.ann-modal,.doc-preview-body,.doc-preview-body-pdf,.re-subj-wrap,.res-wrap,' +
            '.subj-suggest-dd,.twrap,.table-wrap,.rc-twrap,.bulk-preview,.exam-body,#resultScreen,.mob-nav,' +
            'textarea,[style*="overflow"]';
  var MODAL = '.mo,.modal-overlay,.ann-modal,[class*="doc-preview"],[role="dialog"]';

  var css = document.createElement('style');
  css.textContent =
    '.siT{position:fixed;border-radius:6px;background:rgba(13,31,60,.10);pointer-events:none;display:none}' +
    '.siT i{position:absolute;border-radius:6px;background:rgba(13,31,60,.55);display:block}' +
    '.siT.v i{left:0;right:0;min-height:24px}.siT.h i{top:0;bottom:0;min-width:24px}' +
    '@media print{.siT{display:none!important}}';
  document.head.appendChild(css);

  var root = document.scrollingElement || document.documentElement;
  var tracked = new Map();
  var raf = 0, lastDiscover = 0;

  function make(cls, z) {
    var t = document.createElement('div'); t.className = 'siT ' + cls; t.style.zIndex = z;
    t.appendChild(document.createElement('i')); document.body.appendChild(t); return t;
  }

  function clipsFor(el) {
    var out = [], p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      var s = getComputedStyle(p);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') out.push(p);
      p = p.parentElement;
    }
    return out;
  }

  function discover() {
    lastDiscover = Date.now();
    var seen = new Set();
    var list = Array.prototype.slice.call(document.querySelectorAll(SEL));
    var panelV = false;

    list.concat([root]).forEach(function (el) {
      var isRoot = el === root, cs = null;
      if (!isRoot) {
        if (!el.getClientRects().length) return;
        cs = getComputedStyle(el);
        if (cs.visibility === 'hidden') return;
        var rr = el.getBoundingClientRect();
        if (rr.bottom < -50 || rr.top > innerHeight + 50 || rr.right < -50 || rr.left > innerWidth + 50) return;
      }
      var nativeV = isRoot ? (innerWidth - root.clientWidth) >= 6 : (el.offsetWidth - el.clientWidth) >= 6;
      var nativeH = isRoot ? true : (el.offsetHeight - el.clientHeight) >= 6;
      var wantV = (el.scrollHeight - el.clientHeight > 6) && el.clientHeight >= 36 && (isRoot || /auto|scroll/.test(cs.overflowY)) && !nativeV;
      var wantH = !isRoot && (el.scrollWidth - el.clientWidth > 6) && el.clientWidth >= 120 && /auto|scroll/.test(cs.overflowX) && !nativeH;
      if (isRoot && panelV) wantV = false;           // the main panel already shows a bar
      if (!wantV && !wantH) return;
      if (!isRoot && el.matches('.content') && wantV) panelV = true;

      var rec = tracked.get(el);
      if (!rec) {
        var z = (!isRoot && el.closest(MODAL)) ? 10000 : 100;
        rec = { v: null, h: null, z: z, clips: [] };
        tracked.set(el, rec);
      }
      rec.clips = isRoot ? [] : clipsFor(el);
      var small = !isRoot && !el.matches('.content');
      rec.vw = small ? 4 : 6;
      if (wantV && !rec.v) rec.v = make('v', rec.z);
      if (!wantV && rec.v) { rec.v.remove(); rec.v = null; }
      if (wantH && !rec.h) rec.h = make('h', rec.z);
      if (!wantH && rec.h) { rec.h.remove(); rec.h = null; }
      seen.add(el);
    });

    tracked.forEach(function (rec, el) {
      if (!seen.has(el)) { if (rec.v) rec.v.remove(); if (rec.h) rec.h.remove(); tracked.delete(el); }
    });
  }

  function place() {
    tracked.forEach(function (rec, el) {
      var isRoot = el === root;
      var r = isRoot ? { top: 0, left: 0, right: innerWidth, bottom: innerHeight } : el.getBoundingClientRect();
      var top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight),
          left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
      rec.clips.forEach(function (c) {
        var cr = c.getBoundingClientRect();
        top = Math.max(top, cr.top); bottom = Math.min(bottom, cr.bottom);
        left = Math.max(left, cr.left); right = Math.min(right, cr.right);
      });

      if (rec.v) {
        var h = bottom - top - 8;
        if (h < 24) { rec.v.style.display = 'none'; }
        else {
          var sh = el.scrollHeight, ch = el.clientHeight, st = el.scrollTop;
          var tH = Math.max(24, h * ch / sh), maxT = h - tH;
          var pos = sh > ch ? (st / (sh - ch)) * maxT : 0;
          var s = rec.v.style;
          s.display = 'block'; s.width = rec.vw + 'px'; s.top = (top + 4) + 'px'; s.height = h + 'px';
          s.left = (right - rec.vw - (isRoot ? 3 : 2)) + 'px';
          var t = rec.v.firstChild.style; t.height = tH + 'px'; t.top = Math.min(Math.max(pos, 0), maxT) + 'px';
        }
      }
      if (rec.h) {
        var w = right - left - 12;
        if (w < 40) { rec.h.style.display = 'none'; }
        else {
          var sw = el.scrollWidth, cw = el.clientWidth, sl = el.scrollLeft;
          var tW = Math.max(24, w * cw / sw), maxL = w - tW;
          var posL = sw > cw ? (sl / (sw - cw)) * maxL : 0;
          var q = rec.h.style;
          q.display = 'block'; q.height = '4px'; q.left = (left + 6) + 'px'; q.width = w + 'px'; q.top = (bottom - 6) + 'px';
          var u = rec.h.firstChild.style; u.width = tW + 'px'; u.left = Math.min(Math.max(posL, 0), maxL) + 'px';
        }
      }
    });
  }

  function frame() { raf = 0; if (Date.now() - lastDiscover > 300) discover(); place(); }
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', function () { lastDiscover = 0; schedule(); });
  window.addEventListener('orientationchange', function () { lastDiscover = 0; schedule(); });
  window.addEventListener('load', function () { lastDiscover = 0; schedule(); });
  document.addEventListener('click', function () { setTimeout(function () { lastDiscover = 0; schedule(); }, 80); }, true);
  setInterval(function () { lastDiscover = 0; schedule(); }, 700);
  schedule();
})();
