/* Shared marks + grade rules for CBT exams (used by teacher.html, admin CBT Results, and the offline CBT server).
   It reads the admin's Result Settings (settings/resultSettings): the maximum of each column
   (Test 1 / Test 2 / Test 3 / Exam) and the grading bands (A1, B2 ...). Change them in Admin > Result Settings
   and everything follows.
     convert(settings, "test1", 7, 10)  ->  { mark: 14, max: 20, colName: "Test 1", pct: 70, grade: "B2", remark: "Very Good" }
     gradeFor(settings, 70)             ->  { grade: "B2", remark: "Very Good" }                              */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(); else root.CBTGrade = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var COLS = { test1: { name: "Test 1", key: "test1Max" }, test2: { name: "Test 2", key: "test2Max" }, test3: { name: "Test 3", key: "test3Max" }, exam: { name: "Exam", key: "examMax" } };
  var DEFAULT = {
    assessment: { test1Max: 20, test2Max: 20, test3Max: 20, examMax: 60 },
    gradingBands: [
      { grade: "A1", min: 80, max: 100, remark: "Excellent" }, { grade: "B2", min: 70, max: 79, remark: "Very Good" },
      { grade: "B3", min: 65, max: 69, remark: "Good" },      { grade: "C4", min: 60, max: 64, remark: "Credit" },
      { grade: "C5", min: 55, max: 59, remark: "Credit" },    { grade: "C6", min: 50, max: 54, remark: "Credit" },
      { grade: "D7", min: 45, max: 49, remark: "Pass" },      { grade: "E8", min: 40, max: 44, remark: "Pass" },
      { grade: "F9", min: 0, max: 39, remark: "Fail" }
    ]
  };
  function settingsOf(s) {
    s = s || {};
    var a = {}, k, src = s.assessment || {};
    for (k in DEFAULT.assessment) a[k] = src[k] !== undefined && src[k] !== "" ? Number(src[k]) : DEFAULT.assessment[k];
    return { assessment: a, gradingBands: Array.isArray(s.gradingBands) && s.gradingBands.length ? s.gradingBands : DEFAULT.gradingBands };
  }
  function gradeFor(settings, pct) {
    var b = settingsOf(settings).gradingBands, p = Math.round(Number(pct) || 0), i;
    for (i = 0; i < b.length; i++) if (p >= Number(b[i].min) && p <= Number(b[i].max)) return { grade: b[i].grade, remark: b[i].remark || "" };
    var last = b[b.length - 1] || {}; return { grade: last.grade || "—", remark: last.remark || "" };
  }
  function convert(settings, col, score, total) {
    var c = COLS[col]; total = Number(total);
    if (!c || !(total > 0)) return null;
    var S = settingsOf(settings), max = Number(S.assessment[c.key]) || 0;
    if (!max) return null;
    var pct = Number(score) / total * 100;
    var g = gradeFor(S, pct);
    return { col: col, colName: c.name, max: max, mark: Math.min(max, Math.max(0, Math.round(pct / 100 * max))), pct: Math.round(pct), grade: g.grade, remark: g.remark };
  }
  return { COLS: COLS, DEFAULT: DEFAULT, settingsOf: settingsOf, gradeFor: gradeFor, convert: convert };
});
