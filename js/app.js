/* =========================================================
   交投模考 · 应用逻辑
   数据来源：js/data.js (window.EXAMS)
   ========================================================= */
(function () {
  "use strict";

  /* ---------- 常量与工具 ---------- */
  var LS_KEY = "jt_progress_";            // localStorage 前缀
  var SCORE = { single: 1, multiple: 2, judge: 1 };   // 每道客观题分值

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(h) + ":" + p(m) + ":" + p(s);
  }
  function fmtMin(sec) {
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m + "分" + (s ? s + "秒" : "");
  }
  function loadLS(id) {
    try { return JSON.parse(localStorage.getItem(LS_KEY + id)) || null; }
    catch (e) { return null; }
  }
  function saveLS(id, obj) {
    try { localStorage.setItem(LS_KEY + id, JSON.stringify(obj)); } catch (e) {}
  }
  function clearLS(id) {
    try { localStorage.removeItem(LS_KEY + id); } catch (e) {}
  }

  /* ---------- 错题本 ---------- */
  function loadWrongbook() {
    try { return JSON.parse(localStorage.getItem("jt_wrongbook")) || {}; } catch (e) { return {}; }
  }
  function saveWrongbook(wb) {
    try { localStorage.setItem("jt_wrongbook", JSON.stringify(wb)); } catch (e) {}
  }
  function wrongKey(examId, idx) { return examId + ":" + idx; }
  function addWrong(examId, idx, answer) {
    var wb = loadWrongbook();
    var k = wrongKey(examId, idx);
    var e = wb[k] || { examId: examId, idx: idx, wrongCount: 0, lastAnswer: "", lastAt: 0 };
    e.wrongCount++; e.lastAnswer = answer; e.lastAt = Date.now();
    wb[k] = e; saveWrongbook(wb);
  }
  function removeWrong(examId, idx) {
    var wb = loadWrongbook();
    delete wb[wrongKey(examId, idx)];
    saveWrongbook(wb);
  }

  /* ---------- 练习统计（全局正确率） ---------- */
  function loadStats() {
    try { return JSON.parse(localStorage.getItem("jt_stats")) || { answered: 0, correct: 0, byExam: {} }; }
    catch (e) { return { answered: 0, correct: 0, byExam: {} }; }
  }
  function saveStats(s) {
    try { localStorage.setItem("jt_stats", JSON.stringify(s)); } catch (e) {}
  }
  function recordJudge(examId, isRight) {
    var s = loadStats();
    s.answered++;
    if (isRight) s.correct++;
    var b = s.byExam[examId] || { answered: 0, correct: 0 };
    b.answered++;
    if (isRight) b.correct++;
    s.byExam[examId] = b;
    saveStats(s);
  }

  /* 判定后记录（错题本 + 统计） */
  function recordJudged(item, sec, q) {
    var val = state.answers[item.idx];
    var c = isCorrect(sec, q, val);
    if (c === null) return;
    var statExamId = state.exam.isRedo && q._src ? q._src.examId : state.exam.id;
    recordJudge(statExamId, c === true);
    if (state.exam.isRedo && q._src) {
      if (c === true) { removeWrong(q._src.examId, q._src.idx); toast("答对！已从错题本移除 ✓"); }
      else { addWrong(q._src.examId, q._src.idx, val); }
    } else {
      if (c === false) addWrong(state.exam.id, item.idx, val);
    }
    updateAccChip();
    // 即时反馈：答对自动跳下一题；答错暂停计时以便阅读解析
    if (state.feedback) {
      if (c === true) {
        if (state.autoAdvance) clearTimeout(state.autoAdvance);
        state.autoAdvance = setTimeout(function () { goTo(state.current + 1); }, 900);
      } else if (state.timerEnabled) {
        state.paused = true;
        updateTimerUI();
      }
    }
  }

  /* 本次作答正确率（即时反馈模式） */
  function updateAccChip() {
    var chip = $("#acc-chip");
    if (!chip) return;
    if (!state.exam || !state.feedback) { chip.classList.add("hidden"); return; }
    var judged = 0, ok = 0;
    state.flat.list.forEach(function (it) {
      var sec = state.exam.sections[it.si];
      if (!isObjective(sec) || !state.locked[it.idx]) return;
      judged++;
      if (isCorrect(sec, it.q, state.answers[it.idx]) === true) ok++;
    });
    if (!judged) { chip.classList.add("hidden"); return; }
    chip.classList.remove("hidden");
    chip.textContent = "正确率 " + Math.round(ok / judged * 100) + "%（" + ok + "/" + judged + "）";
  }

  /* ---------- 数据模型 ---------- */
  function buildFlat(exam) {
    // 返回 { list: [{idx, section, secIdx, q}], bySec: [[...]] }
    var list = [], bySec = [], idx = 0;
    exam.sections.forEach(function (sec, si) {
      var arr = [];
      sec.questions.forEach(function (q) {
        var item = { idx: idx, si: si, q: q };
        list.push(item); arr.push(item); idx++;
      });
      bySec.push(arr);
    });
    return { list: list, bySec: bySec };
  }
  function objectiveCount(exam) {
    var n = 0;
    exam.sections.forEach(function (s) {
      if (s.type === "single" || s.type === "multiple" || s.type === "judge") n += s.questions.length;
    });
    return n;
  }
  function totalScore(exam) {
    var t = 0;
    exam.sections.forEach(function (s) {
      if (SCORE[s.type]) t += SCORE[s.type] * s.questions.length;
    });
    return t;
  }
  function sectionScore(exam, si) {
    var s = exam.sections[si];
    return SCORE[s.type] ? SCORE[s.type] * s.questions.length : 0;
  }
  function isObjective(sec) {
    return sec.type === "single" || sec.type === "multiple" || sec.type === "judge";
  }
  function isSubjective(sec) {
    return sec.type === "case" || sec.type === "writing";
  }
  function cjkCount(s) {
    return (String(s || "").match(/[\u4e00-\u9fff]/g) || []).length;
  }
  function stemDisplay(q) {
    // 图片题且题干为空白/占位符时，用说明文字代替
    if (q.image) {
      if (!q.stem || cjkCount(q.stem) < 8) {
        return "（本题为图形 / 数字推理题，题目与选项请查看下方原卷图片）";
      }
    }
    return q.stem;
  }
  /* 选词填空：把同一行内的空格还原为横线填空位置（换行处的空格是排版残留，不处理） */
  var FILL_RE = /([\u4e00-\u9fff，。；：、？！])(\s+)([\u4e00-\u9fff，。；：、？！])/g;
  function renderStem(stem) {
    var html = esc(stem);
    if (/填入|填人|横线|最恰当|应填/.test(stem)) {
      html = html.replace(FILL_RE, function (m, a, sp, b) {
        if (sp.indexOf("\n") >= 0) return a + sp + b;
        return a + '<span class="blank"></span>' + b;
      });
    }
    return html;
  }
  function groupSentences(text) {
    var sents = text.split(/(?<=[。！？!?；;])/).map(function (s) { return s.trim(); }).filter(Boolean);
    var out = [];
    for (var i = 0; i < sents.length; i += 3) out.push(sents.slice(i, i + 3).join(""));
    return out.length ? out : [text];
  }
  /* 把参考答案/解析按文意分成段落 */
  function toParagraphs(text, kind) {
    if (!text) return [];
    var flat = String(text).replace(/\s+/g, " ");
    if (kind === "analysis") {
      var parts = flat.split(/(?=[ABCD]\s*项)/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length >= 2) {
        var out = [];
        parts.forEach(function (pt) { out = out.concat(groupSentences(pt)); });
        return out;
      }
      return groupSentences(flat);
    }
    if (kind === "ref") {
      var parts2 = flat.split(/(?=\d+[.、]\s*)/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts2.length >= 2) return parts2;
      return groupSentences(flat);
    }
    return groupSentences(flat);
  }
  function typeName(sec) {
    var map = { single: "单选题", multiple: "多选题", judge: "判断题", case: "案例分析题", writing: "材料写作题" };
    return map[sec.type] || sec.type;
  }

  /* 判定对错 */
  function isCorrect(sec, q, val) {
    if (!isObjective(sec) || !q.answer) return null;   // 主观题不判分
    if (!isAnswered(sec, q, val)) return null;          // 未作答
    if (sec.type === "multiple") {
      var a = val.slice().sort().join(""), b = String(q.answer).split("").sort().join("");
      return a === b;
    }
    if (sec.type === "single" || sec.type === "judge") {
      return String(val) === String(q.answer);
    }
    return null;
  }
  function isAnswered(sec, q, val) {
    if (isObjective(sec)) {
      if (sec.type === "multiple") return Array.isArray(val) && val.length > 0;
      return val !== undefined && val !== null && val !== "";
    }
    return false;
  }

  /* ---------- 应用状态 ---------- */
  var state = {
    exam: null, flat: null,
    view: "home",
    current: 0,                 // 当前题目 flat idx
    answers: {},                // idx -> value
    flags: [],                  // [idx]
    locked: {},                 // idx -> true（已判定并锁定）
    feedback: true,             // 即时反馈开关
    timerEnabled: true,         // 是否倒计时（错题重做时关闭）
    paused: false,              // 答错后暂停计时
    remaining: 0,
    timerId: null,
    autoAdvance: null,          // 答对自动跳题定时器
    annots: {},                 // 题干批注: idx -> [strokes]
    annotMode: false,           // 批注模式开关
    annotTool: "pen",           // pen | highlight | eraser
    annotColor: "#ef4444",
    doneResult: null
  };

  function showView(name) {
    ["home", "exam", "result", "wrongbook"].forEach(function (v) {
      $("#view-" + v).classList.toggle("hidden", v !== name);
    });
    state.view = name;
    window.scrollTo(0, 0);
  }
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.add("hidden"); }, 1800);
  }

  /* =========================================================
     首页
     ========================================================= */
  function renderHome() {
    $("#stat-exams").textContent = window.EXAMS.length;
    var qn = 0;
    window.EXAMS.forEach(function (e) { qn += objectiveCount(e); });
    $("#stat-questions").textContent = qn;
    var done = window.EXAMS.filter(function (e) {
      var p = loadLS(e.id);
      return p && p.status === "done";
    }).length;
    $("#stat-done").textContent = done;

    var wb = loadWrongbook();
    $("#stat-wrong").textContent = Object.keys(wb).length;
    var st = loadStats();
    $("#ps-answered").textContent = st.answered;
    $("#ps-correct").textContent = st.correct;
    $("#ps-rate").textContent = st.answered ? Math.round(st.correct / st.answered * 100) + "%" : "--";

    var list = $("#exam-list");
    list.innerHTML = "";
    window.EXAMS.forEach(function (ex) {
      var p = loadLS(ex.id);
      var card = document.createElement("div");
      card.className = "exam-card";

      var badgeCls = { "2024": "badge-2024", "2025": "badge-2025", "2026v1": "badge-2026v1", "2026v2": "badge-2026v2" };
      var badgeYear = { "2024": "2024 真题", "2025": "2025 真题", "2026v1": "2026 模拟一", "2026v2": "2026 模拟二" };
      var objCount = objectiveCount(ex), subjCount = ex.sections.reduce(function (a, s) { return a + (isSubjective(s) ? s.questions.length : 0); }, 0);

      var progressHtml, actionHtml;
      if (!p) {
        progressHtml = '<div class="exam-card-progress">未开始 · 客观题 ' + objCount + ' 题 · 建议用时 ' + ex.duration + ' 分钟</div>';
        actionHtml = '<button class="btn btn-outline start-btn" data-id="' + ex.id + '">开始考试</button>';
      } else if (p.status === "doing") {
        var answered = Object.keys(p.answers).filter(function (k) { return isAnsweredFor(ex, k, p.answers[k]); }).length;
        progressHtml = '<div class="exam-card-progress">答题中 · 已完成 <b style="color:var(--primary)">' + answered + '/' + objCount + '</b> 题</div>';
        actionHtml = '<button class="btn btn-primary resume-btn" data-id="' + ex.id + '">继续答题</button>' +
                     '<button class="btn btn-danger-ghost reset-btn" data-id="' + ex.id + '" title="重新开始">重置</button>';
      } else {
        var sc = p.doneResult ? p.doneResult.score : 0, tot = p.doneResult ? p.doneResult.total : totalScore(ex);
        progressHtml = '<div class="exam-card-progress progress-done">已完成 · 客观题得分 ' + sc + '/' + tot + '</div>';
        actionHtml = '<button class="btn btn-outline report-btn" data-id="' + ex.id + '">查看报告</button>' +
                     '<button class="btn btn-primary redo-btn" data-id="' + ex.id + '">重新作答</button>';
      }

      card.innerHTML =
        '<div class="exam-card-head">' +
          '<div class="exam-card-title">' + esc(ex.title) + '</div>' +
          '<div class="exam-badge ' + badgeCls[ex.id] + '">' + badgeYear[ex.id] + '</div>' +
        '</div>' +
        '<div class="exam-card-meta">' +
          '<span class="meta-pill">客观题 ' + objCount + ' 题</span>' +
          '<span class="meta-pill">主观题 ' + subjCount + ' 题</span>' +
          '<span class="meta-pill">' + ex.duration + ' 分钟</span>' +
        '</div>' +
        progressHtml +
        '<div class="exam-card-actions">' + actionHtml + '</div>';
      list.appendChild(card);
    });

    // 错题本面板
    var wbBody = $("#wb-panel-body");
    var wbKeys = Object.keys(loadWrongbook());
    if (!wbKeys.length) {
      wbBody.innerHTML = "暂无错题。开启「即时反馈」答题，答错的题会自动收录到这里。";
    } else {
      var inner = "共 <b style='color:var(--red)'>" + wbKeys.length + "</b> 道错题：";
      inner += '<div class="wb-panel-per-exam">';
      window.EXAMS.forEach(function (ex) {
        var n = 0;
        wbKeys.forEach(function (k) { if (loadWrongbook()[k].examId === ex.id) n++; });
        if (n) inner += '<span class="wb-mini">' + esc(ex.title.slice(0, 12)) + " <b>" + n + "</b> 题</span>";
      });
      inner += "</div>";
      wbBody.innerHTML = inner;
    }
    showView("home");
  }

  function isAnsweredFor(ex, idxKey, val) {
    // 用于首页统计（无需完整解析）
    var idx = parseInt(idxKey, 10);
    var sec = ex.sections.find(function (s, si) {
      var sum = 0;
      for (var i = 0; i < si; i++) sum += ex.sections[i].questions.length;
      return idx >= sum && idx < sum + s.questions.length;
    });
    return isAnswered(sec, null, val);
  }

  /* =========================================================
     错题本
     ========================================================= */
  function findWbItem(entry) {
    var ex = window.EXAMS.find(function (e) { return e.id === entry.examId; });
    if (!ex) return null;
    var flat = buildFlat(ex);
    return flat.list[entry.idx] || null;
  }

  function wbCard(entry, ex) {
    var item = findWbItem(entry);
    if (!item) return "";
    var sec = ex.sections[item.si], q = item.q;
    var html = '<div class="review-card wb-card">';
    html +=
      '<div class="review-q-head">' +
        '<span class="q-num" style="font-size:16px">' + (entry.idx + 1) + ".</span>" +
        '<span class="q-type type-' + sec.type + '">' + typeName(sec) + "</span>" +
        '<span class="review-result-tag tag-wrong">错题</span>' +
        '<span class="q-type" style="background:var(--red-light);color:var(--red)">答错 ' + entry.wrongCount + ' 次</span>' +
      "</div>";
    html += '<div class="review-stem">' + renderStem(stemDisplay(q)) + "</div>";
    if (q.image) {
      html += '<div class="q-image"><img src="' + q.image.src + '" loading="lazy"><div class="q-image-caption">原卷第 ' + q.image.page + " 页截图</div></div>";
    }
    if (isObjective(sec) && q.options.length) {
      html += '<div class="review-options">';
      q.options.forEach(function (o) {
        var isRight = String(q.answer).indexOf(o.key) >= 0;
        var isMine = String(entry.lastAnswer).indexOf(o.key) >= 0;
        var cls = isRight ? "is-correct" : (isMine ? "is-wrong" : "");
        html += '<div class="review-opt ' + cls + '"><span class="k">' + o.key + ".</span><span>" + esc(o.text) + "</span></div>";
      });
      html += "</div>";
    }
    var myTxt = entry.lastAnswer || "未作答";
    var rightTxt = sec.type === "judge" ? (q.answer === "A" ? "A（正确）" : "B（错误）") : String(q.answer);
    html +=
      '<div class="review-answers">' +
        '<span class="my wrong">我的答案：' + esc(myTxt) + "</span>" +
        '<span style="margin:0 10px;color:var(--gray)">|</span>' +
        '<span class="right">正确答案：' + esc(rightTxt) + "</span>" +
      "</div>";
    if (q.analysis) {
      var ap = toParagraphs(q.analysis, "analysis");
      html += '<div class="analysis-box"><div class="analysis-title">解析</div>' + ap.map(function (pt) { return '<div class="ana-para">' + esc(pt) + "</div>"; }).join("") + "</div>";
    }
    html +=
      '<div class="wb-actions">' +
        '<button class="btn btn-primary wb-redo" data-key="' + wrongKey(entry.examId, entry.idx) + '">重做本题</button>' +
        '<button class="btn btn-danger-ghost wb-del" data-key="' + wrongKey(entry.examId, entry.idx) + '">移出错题本</button>' +
      "</div>";
    html += "</div>";
    return html;
  }

  function renderWrongbook() {
    var wb = loadWrongbook();
    var keys = Object.keys(wb);
    $("#wb-sub").textContent = "共 " + keys.length + " 题";
    var st = loadStats();
    var rate = st.answered ? Math.round(st.correct / st.answered * 100) + "%" : "--";
    $("#wb-stats").innerHTML =
      '<div class="wb-stat"><div class="wb-stat-num red">' + keys.length + '</div><div class="wb-stat-label">错题总数</div></div>' +
      '<div class="wb-stat"><div class="wb-stat-num blue">' + st.answered + '</div><div class="wb-stat-label">累计已答</div></div>' +
      '<div class="wb-stat"><div class="wb-stat-num green">' + rate + '</div><div class="wb-stat-label">累计正确率</div></div>';

    var list = $("#wb-list");
    list.innerHTML = "";
    if (!keys.length) {
      list.innerHTML = '<div class="wb-empty">🎉 暂无错题，继续保持！</div>';
      showView("wrongbook");
      return;
    }
    var filter = ($("#wb-filters .filter-tab.active") || {}).dataset && $("#wb-filters .filter-tab.active").dataset.wf;
    window.EXAMS.forEach(function (ex) {
      var entries = keys.map(function (k) { return wb[k]; })
        .filter(function (e) { return e.examId === ex.id; })
        .sort(function (a, b) { return a.idx - b.idx; });
      if (!entries.length) return;
      var html = '<div class="wb-group-title">' + esc(ex.title) + ' <span class="badge badge-' + ex.id + '">' + entries.length + " 题</span></div>";
      entries.forEach(function (e) { html += wbCard(e, ex); });
      list.insertAdjacentHTML("beforeend", html);
    });
    showView("wrongbook");
  }

  function startRedo(entries) {
    var groups = {};
    entries.forEach(function (entry) {
      var item = findWbItem(entry);
      if (!item) return;
      var ex = window.EXAMS.find(function (e) { return e.id === entry.examId; });
      var sec = ex.sections[item.si];
      var key = entry.examId + "|" + sec.type;
      if (!groups[key]) groups[key] = { ex: ex, sec: sec, list: [] };
      var q = {};
      Object.keys(item.q).forEach(function (k) { q[k] = item.q[k]; });
      q._src = { examId: entry.examId, idx: entry.idx };
      groups[key].list.push(q);
    });
    var sections = Object.keys(groups).map(function (key) {
      var g = groups[key];
      return {
        name: g.ex.title.slice(0, 4) + " · " + typeName(g.sec),
        type: g.sec.type,
        materials: g.sec.materials || [],
        questions: g.list
      };
    });
    if (!sections.length) { toast("没有可重做的错题"); return; }
    var total = sections.reduce(function (a, s) { return a + s.questions.length; }, 0);
    state.exam = {
      id: "redo", title: "错题重做", subtitle: "共 " + total + " 题 · 答对自动移出错题本",
      duration: 0, isRedo: true, sections: sections
    };
    state.flat = buildFlat(state.exam);
    state.answers = {};
    state.flags = [];
    state.locked = {};
    state.current = 0;
    state.doneResult = null;
    state.feedback = true;
    state.timerEnabled = false;
    $("#exam-title").textContent = state.exam.title;
    $("#exam-sub").textContent = state.exam.subtitle;
    showView("exam");
    updateFeedbackBtn();
    renderQuestion();
    renderSheet();
    updateAccChip();
    startTimer();
  }

  function finishRedo() {
    var removed = 0, still = 0, skip = 0;
    state.flat.list.forEach(function (it) {
      var sec = state.exam.sections[it.si];
      if (!isObjective(sec)) return;
      var c = isCorrect(sec, it.q, state.answers[it.idx]);
      if (c === true) removed++;
      else if (c === false) still++;
      else skip++;
    });
    $("#submit-modal").classList.add("hidden");
    toast("重做完成：答对 " + removed + " 题（已移出错题本）· 仍错 " + still + " 题 · 未答 " + skip + " 题");
    renderWrongbook();
  }

  /* =========================================================
     答题页
     ========================================================= */
  function startExam(id, resume) {
    var ex = window.EXAMS.find(function (e) { return e.id === id; });
    state.exam = ex;
    state.flat = buildFlat(ex);
    state.answers = {};
    state.flags = [];
    state.locked = {};
    state.current = 0;
    state.doneResult = null;
    state.feedback = localStorage.getItem("jt_feedback") !== "0";
    state.timerEnabled = true;

    var p = loadLS(id);
    if (resume && p && p.status === "doing") {
      state.answers = p.answers || {};
      state.flags = p.flags || [];
      state.locked = p.locked || {};
      var elapsed = p.elapsed || 0;
      state.remaining = Math.max(0, ex.duration * 60 - elapsed);
      if (state.remaining <= 0) {
        // 时间已到，直接判卷
        finishExam(true);
        return;
      }
    } else {
      state.remaining = ex.duration * 60;
    }
    $("#exam-title").textContent = ex.title;
    $("#exam-sub").textContent = (ex.subtitle || "") + " · 共 " + state.flat.list.length + " 题";
    showView("exam");
    updateFeedbackBtn();
    renderQuestion();
    renderSheet();
    updateAccChip();
    startTimer();
  }

  function startTimer() {
    stopTimer();
    if (!state.timerEnabled) { updateTimerUI(); return; }
    state.timerId = setInterval(function () {
      state.remaining--;
      if (state.paused) { updateTimerUI(); return; }
      if (state.remaining <= 0) {
        state.remaining = 0;
        updateTimerUI();
        stopTimer();
        saveProgress();
        showTimeup();
        return;
      }
      updateTimerUI();
      saveProgress();
    }, 1000);
    updateTimerUI();
  }
  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }
  function updateTimerUI() {
    var el = $("#timer");
    if (state.exam && state.exam.isRedo) {
      el.textContent = "错题重做";
      el.classList.remove("warn");
      el.classList.remove("paused");
      return;
    }
    if (state.paused) {
      el.textContent = "⏸ 已暂停";
      el.classList.add("paused");
      el.classList.remove("warn");
      return;
    }
    el.classList.remove("paused");
    el.textContent = fmtTime(state.remaining);
    el.classList.toggle("warn", state.remaining <= 300 && state.remaining > 0);
  }
  function saveProgress() {
    if (!state.exam || state.exam.isRedo) return;
    var elapsed = state.exam.duration * 60 - state.remaining;
    saveLS(state.exam.id, { status: "doing", answers: state.answers, flags: state.flags, locked: state.locked, elapsed: elapsed });
  }

  /* 渲染当前题目 */
  function renderQuestion() {
    var item = state.flat.list[state.current];
    var sec = state.exam.sections[item.si];
    var q = item.q;
    var pane = $("#question-pane");
    var isJudge = sec.type === "judge";
    var val = state.answers[item.idx];
    var isSubj = isSubjective(sec);
    var feedbackOn = state.feedback && isObjective(sec);
    var locked = feedbackOn && !!state.locked[item.idx];

    var flagCls = state.flags.indexOf(item.idx) >= 0 ? "flagged" : "";
    var flagTxt = state.flags.indexOf(item.idx) >= 0 ? "已标记" : "标记";
    var annoCls = state.annotMode ? "anno-on" : "";

    var stemHtml = '<div class="q-stem">' + renderStem(stemDisplay(q)) + "</div>";

    // 材料（置于题干上方）
    var materialHtml = "";
    if (q.materialId) {
      var mat = sec.materials.find(function (m) { return m.id === q.materialId; });
      if (mat) {
        materialHtml =
          '<div class="material-panel open" id="material-panel">' +
            '<div class="material-head" id="material-head"><span>📋 材料</span><span class="arrow">▾</span></div>' +
            '<div class="material-body">' + esc(mat.text) + "</div>" +
          "</div>";
      }
    }

    // 原卷图片
    var imageHtml = "";
    if (q.image) {
      var cap = q.image.kind === "chart" ? "资料图表（原卷第 " + q.image.page + " 页）" : "本题含图片 · 原卷第 " + q.image.page + " 页截图（可能包含相邻题目）";
      imageHtml = '<div class="q-image"><img src="' + q.image.src + '" alt="原题图片" loading="lazy"><div class="q-image-caption">' + cap + "</div></div>";
    }

    // 选项数据（图片题用字母键补齐）
    var optsData = q.options;
    if (isObjective(sec) && !optsData.length) {
      var letters = q.answer ? String(q.answer).split("") : ["A", "B", "C", "D"];
      var uniq = []; letters.forEach(function (L) { if (uniq.indexOf(L) < 0) uniq.push(L); });
      if (uniq.length < 2) uniq = ["A", "B", "C", "D"];
      optsData = uniq.map(function (L) {
        return { key: L, text: "（图片选项，请在原图中选择后点选字母作答）" };
      });
    }

    function isSel(key) {
      if (sec.type === "multiple") return Array.isArray(val) && val.indexOf(key) >= 0;
      return val === key;
    }
    function optHtml(o) {
      var cls = "option";
      if (locked) {
        var right = String(q.answer).indexOf(o.key) >= 0;
        var mine = isSel(o.key);
        if (right) cls += " correct locked";
        else if (mine) cls += " wrong locked";
        else cls += " muted locked";
      } else if (isSel(o.key)) {
        cls += " selected";
      }
      return '<div class="' + cls + '" data-key="' + o.key + '">' +
        '<span class="option-key">' + o.key + "</span>" +
        '<span class="option-text">' + esc(o.text) + "</span></div>";
    }

    var optionsHtml = "";
    var feedbackHtml = "";
    if (isObjective(sec)) {
      optionsHtml = '<div class="q-options">' + optsData.map(optHtml).join("") + "</div>";
      if (feedbackOn && sec.type === "multiple" && !locked) {
        optionsHtml += '<button class="btn btn-primary btn-confirm-multi" id="btn-confirm-multi">确认答案</button>';
      }
      if (feedbackOn && !q.options.length) {
        optionsHtml += '<div style="font-size:12px;color:var(--gray);margin-top:8px">本题选项为图片，请在图片中查看选项内容，再点击对应字母作答。</div>';
      }
      if (locked) {
        var c = isCorrect(sec, q, val);
        var rightTxt = sec.type === "judge" ? (q.answer === "A" ? "A（正确）" : "B（错误）") : String(q.answer);
        var paras = toParagraphs(q.analysis, "analysis");
        var anaHtml = paras.length
          ? '<div class="analysis-box"><div class="analysis-title">参考答案与解析</div>' + paras.map(function (pt) { return '<div class="ana-para">' + esc(pt) + "</div>"; }).join("") + "</div>"
          : "";
        feedbackHtml =
          (c === true
            ? '<div class="q-feedback correct">✓ 回答正确！</div>'
            : '<div class="q-feedback wrong">✗ 回答错误，正确答案：<span class="right-ans">' + esc(rightTxt) + "</span></div>" +
              (state.timerEnabled && !state.exam.isRedo ? '<div class="pause-hint">⏸ 时间已暂停，阅读解析后点击「下一题」继续</div>' : "")) +
          anaHtml;
      }
    } else {
      optionsHtml =
        '<textarea class="answer-textarea" id="subj-answer" placeholder="请在此作答…">' + esc(val || "") + "</textarea>" +
        '<div style="font-size:12px;color:var(--gray);margin-top:6px">主观题不自动判分' + (state.feedback ? "，作答后可查看参考答案自评" : "，交卷后展示参考答案供自评") + "。</div>";
      if (state.feedback && q.refAnswer) {
        optionsHtml += '<button class="btn-ref-toggle" id="btn-ref-toggle">📖 查看参考答案</button>';
      }
    }

    // 批注工具栏（批注模式下显示）
    var annotHtml = "";
    if (state.annotMode) {
      var swatches = [
        { color: "#ef4444", name: "红" }, { color: "#2f6bff", name: "蓝" },
        { color: "#1f2937", name: "黑" }, { color: "#ffd54f", name: "荧光" }
      ];
      annotHtml =
        '<div class="annot-toolbar">' +
          '<span class="annot-hint">✏️ 批注：</span>' +
          swatches.map(function (s) {
            return '<button class="annot-swatch' + (state.annotColor === s.color ? " active" : "") + '" data-color="' + s.color + '" style="background:' + s.color + '" title="' + s.name + '"></button>';
          }).join("") +
          '<button class="annot-tool-btn' + (state.annotTool === "pen" ? " active" : "") + '" data-tool="pen">画笔</button>' +
          '<button class="annot-tool-btn' + (state.annotTool === "highlight" ? " active" : "") + '" data-tool="highlight">荧光笔</button>' +
          '<button class="annot-tool-btn' + (state.annotTool === "eraser" ? " active" : "") + '" data-tool="eraser">橡皮</button>' +
          '<button class="annot-tool-btn" id="annot-clear">清空</button>' +
          '<button class="annot-tool-btn" id="annot-done">完成</button>' +
        "</div>";
    }

    pane.innerHTML =
      '<div class="q-head">' +
        '<span class="q-num">' + (item.idx + 1) + ".</span>" +
        '<span class="q-type type-' + sec.type + '">' + typeName(sec) + "</span>" +
        '<span class="q-type" style="background:var(--gray-light);color:var(--gray)">' + (isSubj ? "主观题" : "客观题 " + (SCORE[sec.type] || 0) + "分") + "</span>" +
        '<button class="q-flag-btn ' + annoCls + '" id="btn-anno">✏️ 批注</button>' +
        '<button class="q-flag-btn ' + flagCls + '" id="btn-flag">⛳ ' + flagTxt + "</button>" +
      "</div>" +
      '<div class="q-content" id="q-content">' +
        (state.annotMode ? annotHtml : "") +
        materialHtml +
        imageHtml +
        stemHtml +
        optionsHtml +
        feedbackHtml +
        (state.annotMode ? '<canvas class="annot-canvas active" id="annot-canvas"></canvas>' : "") +
      "</div>" +
      '<div class="q-nav">' +
        '<button class="btn btn-ghost" id="btn-prev"' + (state.current === 0 ? " disabled" : "") + ">‹ 上一题</button>" +
        '<button class="btn btn-ghost" id="btn-next"' + (state.current === state.flat.list.length - 1 ? " disabled" : "") + ">下一题 ›</button>" +
      "</div>" +
      '<div class="q-counter">' + (state.current + 1) + " / " + state.flat.list.length + "</div>";

    // 事件
    if (isObjective(sec) && !locked) {
      var opts = $$(".option", pane);
      opts.forEach(function (el) {
        el.addEventListener("click", function () {
          if (isJudge || sec.type === "single") {
            setAnswer(item.idx, el.dataset.key);
            if (feedbackOn) {
              state.locked[item.idx] = true;
              recordJudged(item, sec, q);
            }
            saveProgress();
            renderQuestion();
            renderSheet();
          } else if (sec.type === "multiple") {
            var arr = Array.isArray(val) ? val.slice() : [];
            var i = arr.indexOf(el.dataset.key);
            if (i >= 0) arr.splice(i, 1); else arr.push(el.dataset.key);
            setAnswer(item.idx, arr);
            renderQuestion();
            renderSheet();
          }
        });
      });
      var confirmBtn = $("#btn-confirm-multi", pane);
      if (confirmBtn) {
        confirmBtn.addEventListener("click", function () {
          var arr = state.answers[item.idx];
          if (Array.isArray(arr) && arr.length) {
            state.locked[item.idx] = true;
            recordJudged(item, sec, q);
            saveProgress();
            renderQuestion();
            renderSheet();
          } else {
            toast("请先选择至少一个选项");
          }
        });
      }
    }
    var subj = $("#subj-answer", pane);
    if (subj) {
      subj.addEventListener("input", function () {
        state.answers[item.idx] = subj.value;
        saveProgress();
      });
    }
    var refBtn = $("#btn-ref-toggle", pane);
    if (refBtn) {
      refBtn.addEventListener("click", function () {
        var inline = $(".ref-inline", pane);
        if (inline) {
          inline.remove();
          refBtn.textContent = "📖 查看参考答案";
        } else {
          var paras = toParagraphs(q.refAnswer, "ref");
          var div = document.createElement("div");
          div.className = "ref-inline";
          div.innerHTML = paras.map(function (pt) { return "<p>" + esc(pt) + "</p>"; }).join("");
          refBtn.insertAdjacentElement("afterend", div);
          refBtn.textContent = "📖 收起参考答案";
        }
      });
    }
    $("#btn-prev", pane).addEventListener("click", function () { goTo(state.current - 1); });
    $("#btn-next", pane).addEventListener("click", function () { goTo(state.current + 1); });
    var flagBtn = $("#btn-flag", pane);
    if (flagBtn) flagBtn.addEventListener("click", toggleFlag);
    var annoBtn = $("#btn-anno", pane);
    if (annoBtn) annoBtn.addEventListener("click", function () {
      state.annotMode = !state.annotMode;
      renderQuestion();
    });
    setupAnnotation(pane, item);
    var matHead = $("#material-head", pane);
    if (matHead) {
      matHead.addEventListener("click", function () {
        $("#material-panel", pane).classList.toggle("open");
      });
    }
    updateAccChip();
  }

  /* 题干批注：圈画 / 高亮 / 橡皮 */
  function setupAnnotation(pane, item) {
    var qc = $("#q-content", pane);
    var canvas = $("#annot-canvas", pane);
    if (!qc || !canvas) return;
    var ctx = canvas.getContext("2d");
    function redraw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var strokes = state.annots[item.idx] || [];
      strokes.forEach(function (st) {
        if (!st.pts || st.pts.length < 1) return;
        ctx.globalAlpha = st.tool === "highlight" ? 0.45 : 1;
        ctx.strokeStyle = st.color;
        ctx.lineWidth = st.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(st.pts[0].x, st.pts[0].y);
        for (var i = 1; i < st.pts.length; i++) ctx.lineTo(st.pts[i].x, st.pts[i].y);
        ctx.stroke();
        if (st.tool === "eraser" && st.pts.length === 1) {
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(st.pts[0].x, st.pts[0].y, st.width / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
    }
    function sizeCanvas() {
      canvas.width = Math.max(1, qc.clientWidth);
      canvas.height = Math.max(1, qc.scrollHeight);
      redraw();
    }
    sizeCanvas();
    // 内容变化时重新定位（图片加载等）
    var imgs = $$("img", qc);
    imgs.forEach(function (im) {
      if (im.complete) return;
      im.addEventListener("load", sizeCanvas);
    });
    var drawing = null;
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var tool = state.annotTool;
      var color = tool === "eraser" ? "#ffffff" : state.annotColor;
      var width = tool === "highlight" ? 26 : (tool === "eraser" ? 24 : 3);
      drawing = { tool: tool, color: color, width: width, pts: [{ x: e.offsetX, y: e.offsetY }] };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      state.annots[item.idx] = state.annots[item.idx] || [];
      state.annots[item.idx].push(drawing);
      redraw();
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drawing) return;
      drawing.pts.push({ x: e.offsetX, y: e.offsetY });
      redraw();
    });
    function endStroke() { drawing = null; }
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    // 工具栏
    $$(".annot-swatch", pane).forEach(function (b) {
      b.addEventListener("click", function () {
        state.annotColor = b.dataset.color;
        $$(".annot-swatch", pane).forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
      });
    });
    $$(".annot-tool-btn", pane).forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.id === "annot-clear") { state.annots[item.idx] = []; redraw(); return; }
        if (b.id === "annot-done") { state.annotMode = false; renderQuestion(); return; }
        state.annotTool = b.dataset.tool;
        $$(".annot-tool-btn", pane).forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
      });
    });
  }

  function updateFeedbackBtn() {
    var b = $("#btn-feedback");
    if (!b) return;
    b.textContent = "即时反馈 " + (state.feedback ? "开" : "关");
    b.classList.toggle("off", !state.feedback);
  }

  function setAnswer(idx, val) {
    state.answers[idx] = val;
    saveProgress();
  }
  function toggleFlag() {
    var i = state.flags.indexOf(state.current);
    if (i >= 0) state.flags.splice(i, 1); else state.flags.push(state.current);
    saveProgress();
    renderQuestion();
    renderSheet();
  }
  function goTo(idx) {
    if (idx < 0 || idx >= state.flat.list.length) return;
    if (state.autoAdvance) { clearTimeout(state.autoAdvance); state.autoAdvance = null; }
    if (state.paused) { state.paused = false; updateTimerUI(); }
    state.current = idx;
    renderQuestion();
    renderSheet();
    var pane = $("#question-pane");
    if (pane) pane.scrollTop = 0;
  }

  /* 答题卡 */
  function renderSheet() {
    var body = buildSheetHTML();
    $("#answer-sheet").innerHTML = body;
    $("#drawer-sheet-body").innerHTML = body;
    var answered = 0;
    state.flat.list.forEach(function (it) {
      var sec = state.exam.sections[it.si];
      if (isObjective(sec) && isAnswered(sec, it.q, state.answers[it.idx])) answered++;
    });
    $("#fab-count").textContent = answered + "/" + objectiveCount(state.exam);
    bindSheetClicks();
  }
  function buildSheetHTML() {
    var answered = 0, flagged = 0, total = state.flat.list.length;
    state.flat.list.forEach(function (it) {
      var sec = state.exam.sections[it.si];
      if (isObjective(sec) && isAnswered(sec, it.q, state.answers[it.idx])) answered++;
    });
    flagged = state.flags.length;
    var html =
      '<div class="sheet-summary">' +
        "<span>已答 <b style='color:var(--primary)'>" + answered + "</b> / " + objectiveCount(state.exam) + "</span>" +
        "<span>标记 <b style='color:#d97706'>" + flagged + "</b></span>" +
      "</div>";
    state.flat.bySec.forEach(function (arr, si) {
      var sec = state.exam.sections[si];
      var head = typeName(sec) + (isSubjective(sec) ? "" : "（" + (SCORE[sec.type] || 0) + "分/题）");
      html += '<div class="sheet-group"><div class="sheet-group-title"><span>' + head + "</span></div><div class='sheet-grid'>";
      arr.forEach(function (it) {
        var sec2 = state.exam.sections[it.si];
        var cls = "";
        if (isObjective(sec2)) {
          if (isAnswered(sec2, it.q, state.answers[it.idx])) cls += " answered";
          if (it.idx === state.current) cls += " current";
          if (state.flags.indexOf(it.idx) >= 0) cls += " flagged";
        } else {
          if (state.answers[it.idx]) cls += " answered";
          if (it.idx === state.current) cls += " current";
          if (state.flags.indexOf(it.idx) >= 0) cls += " flagged";
        }
        html += '<div class="sheet-cell' + cls + '" data-idx="' + it.idx + '">' + (it.idx + 1) + "</div>";
      });
      html += "</div></div>";
    });
    html +=
      '<div class="legend">' +
        '<span class="legend-item"><span class="legend-dot" style="background:var(--primary)"></span>已答</span>' +
        '<span class="legend-item"><span class="legend-dot" style="background:var(--gray-light);border:1px solid var(--border)"></span>未答</span>' +
        '<span class="legend-item"><span class="legend-dot" style="background:#fff;border:2px solid var(--orange)"></span>标记</span>' +
      "</div>";
    return html;
  }
  function bindSheetClicks() {
    $$(".sheet-cell").forEach(function (el) {
      el.addEventListener("click", function () {
        goTo(parseInt(el.dataset.idx, 10));
        $("#sheet-drawer").classList.add("hidden");
        $("#sheet-mask").classList.add("hidden");
      });
    });
  }

  /* 交卷 */
  function openSubmitModal() {
    var answered = 0, total = 0;
    state.flat.list.forEach(function (it) {
      var sec = state.exam.sections[it.si];
      if (isObjective(sec)) {
        total++;
        if (isAnswered(sec, it.q, state.answers[it.idx])) answered++;
      }
    });
    var unanswered = total - answered;
    $("#m-answered").textContent = answered;
    $("#m-unanswered").textContent = unanswered;
    $("#m-flagged").textContent = state.flags.length;
    var isRedo = !!(state.exam && state.exam.isRedo);
    $(".modal-title", $("#submit-modal")).textContent = isRedo ? "完成重做？" : "确认交卷？";
    $("#m-warn").textContent = unanswered > 0
      ? (isRedo ? "还有 " + unanswered + " 题未重做，未重做的题目将保留在错题本。" : "还有 " + unanswered + " 道客观题未作答，确定交卷？")
      : (isRedo ? "未重做题目将保留在错题本。" : "全部作答完成，交卷后不可修改。");
    $("#submit-modal").classList.remove("hidden");
  }
  function finishExam(timeup) {
    stopTimer();
    saveProgress();
    // 计算成绩
    var score = 0, correct = 0, wrong = 0, skip = 0;
    var secStats = state.exam.sections.map(function (sec, si) {
      var st = { name: sec.name, type: sec.type, correct: 0, wrong: 0, skip: 0, score: 0, total: sectionScore(state.exam, si) };
      return st;
    });
    state.flat.list.forEach(function (it) {
      var sec = state.exam.sections[it.si];
      if (!isObjective(sec)) return;
      var val = state.answers[it.idx];
      var c = isCorrect(sec, it.q, val);
      var pts = SCORE[sec.type] || 0;
      if (c === true) { correct++; score += pts; secStats[it.si].correct++; secStats[it.si].score += pts; }
      else if (c === false) { wrong++; secStats[it.si].wrong++; }
      else { skip++; secStats[it.si].skip++; }
      // 记录统计与错题本（即时反馈已记录的跳过）
      if (!state.locked[it.idx]) {
        if (c === true) recordJudge(state.exam.id, true);
        else if (c === false) { recordJudge(state.exam.id, false); addWrong(state.exam.id, it.idx, val); }
      }
    });
    var elapsed = state.exam.duration * 60 - state.remaining;
    state.doneResult = {
      score: score, total: totalScore(state.exam), correct: correct, wrong: wrong, skip: skip,
      elapsed: elapsed, secStats: secStats
    };
    saveLS(state.exam.id, {
      status: "done", answers: state.answers, flags: state.flags,
      elapsed: elapsed, doneResult: state.doneResult
    });
    $("#timeup-modal").classList.add("hidden");
    $("#submit-modal").classList.add("hidden");
    renderResult();
    if (timeup) {
      // 显示时间到弹窗，点击后查看报告（renderResult 已渲染）
      $("#timeup-modal").classList.remove("hidden");
    }
  }

  /* =========================================================
     成绩页
     ========================================================= */
  function renderResult() {
    var ex = state.exam;
    var r = state.doneResult;
    $("#result-title").textContent = ex.title;
    $("#result-sub").textContent = (ex.subtitle || "") + " · 已完成";
    $("#score-num").textContent = r.score;
    $("#score-total").textContent = "/ " + r.total;
    var rate = r.total ? Math.round(r.score / r.total * 100) : 0;
    $("#score-extra").textContent = "正确率 " + rate + "%（仅客观题自动判分）";
    $("#r-correct").textContent = r.correct;
    $("#r-wrong").textContent = r.wrong;
    $("#r-skip").textContent = r.skip;
    $("#r-time").textContent = fmtMin(r.elapsed);

    // 各题型统计
    var bd = $("#section-breakdown");
    var html = '<div class="section-breakdown-title">各题型得分</div>';
    r.secStats.forEach(function (st) {
      if (st.type === "case" || st.type === "writing") {
        html +=
          '<div class="sec-row">' +
            '<span class="sec-name">' + esc(st.name.replace(/（.*/, "")) + "</span>" +
            '<span class="sec-bar-wrap" style="flex:1"></span>' +
            '<span class="sec-stat" style="color:var(--gray)">主观题 · 参考自评</span>' +
          "</div>";
        return;
      }
      var pct = st.total ? st.score / st.total : 0;
      var barCls = pct >= 0.8 ? "" : (pct > 0 ? "partial" : "zero");
      html +=
        '<div class="sec-row">' +
          '<span class="sec-name">' + esc(st.name.replace(/（.*/, "")) + "</span>" +
          '<span class="sec-bar-wrap"><span class="sec-bar ' + barCls + '" style="width:' + (pct * 100).toFixed(1) + '%"></span></span>' +
          '<span class="sec-stat">' + st.score + "/" + st.total + " · 对" + st.correct + " 错" + st.wrong + " 未答" + st.skip + "</span>" +
        "</div>";
    });
    bd.innerHTML = html;

    $("#filter-tabs").dataset.exam = ex.id;
    renderReview("all");
    showView("result");
  }

  function renderReview(filter) {
    var ex = state.exam, r = state.doneResult;
    var list = $("#review-list");
    list.innerHTML = "";
    state.flat.list.forEach(function (it) {
      var sec = ex.sections[it.si], q = it.q;
      var val = state.answers[it.idx];
      var isObj = isObjective(sec);
      var c = isObj ? isCorrect(sec, q, val) : null;
      var answered = isObj ? isAnswered(sec, q, val) : (val ? true : false);

      // 筛选
      if (filter === "correct" && c !== true) return;
      if (filter === "wrong" && c !== false) return;
      if (filter === "skip" && (c !== null || answered)) return;
      if (filter === "flagged" && state.flags.indexOf(it.idx) < 0) return;

      var tag, tagCls;
      if (!isObj) { tag = "主观题"; tagCls = "tag-skip"; }
      else if (c === true) { tag = "✓ 正确"; tagCls = "tag-correct"; }
      else if (c === false) { tag = "✗ 错误"; tagCls = "tag-wrong"; }
      else { tag = "未作答"; tagCls = "tag-skip"; }

      var html = '<div class="review-card">';
      html +=
        '<div class="review-q-head">' +
          '<span class="q-num" style="font-size:16px">' + (it.idx + 1) + ".</span>" +
          '<span class="q-type type-' + sec.type + '">' + typeName(sec) + "</span>" +
          '<span class="review-result-tag ' + tagCls + '">' + tag + "</span>" +
          (state.flags.indexOf(it.idx) >= 0 ? '<span class="q-type" style="background:var(--orange-light);color:#d97706">⛳ 标记</span>' : "") +
        "</div>";
      if (q.materialId) {
        var mat = sec.materials.find(function (m) { return m.id === q.materialId; });
        if (mat) {
          html += '<details class="material-panel" style="margin-top:0"><summary class="material-head" style="cursor:pointer">📋 材料</summary><div class="material-body" style="display:block;padding-top:6px">' + esc(mat.text) + "</div></details>";
        }
      }
      if (q.image) {
        html += '<div class="q-image"><img src="' + q.image.src + '" loading="lazy"><div class="q-image-caption">原卷第 ' + q.image.page + " 页截图</div></div>";
      }
      html += '<div class="review-stem">' + renderStem(stemDisplay(q)) + "</div>";

      if (isObj && q.options.length) {
        html += '<div class="review-options">';
        q.options.forEach(function (o) {
          var isRight = String(q.answer).indexOf(o.key) >= 0;
          var isMine = sec.type === "multiple" ? (Array.isArray(val) && val.indexOf(o.key) >= 0) : (val === o.key);
          var cls = isRight ? "is-correct" : (isMine ? "is-wrong" : "");
          html += '<div class="review-opt ' + cls + '"><span class="k">' + o.key + ".</span><span>" + esc(o.text) + "</span></div>";
        });
        html += "</div>";
      }

      if (isObj) {
        var myTxt = "";
        if (sec.type === "multiple") myTxt = Array.isArray(val) && val.length ? val.join("") : "未作答";
        else myTxt = val ? String(val) : "未作答";
        var rightTxt = sec.type === "judge" ? (q.answer === "A" ? "A（正确）" : "B（错误）") : String(q.answer);
        var myCls = c === true ? "" : (c === false ? " wrong" : "");
        html +=
          '<div class="review-answers">' +
            '<span class="my' + myCls + '">我的答案：' + esc(myTxt) + "</span>" +
            '<span style="margin:0 10px;color:var(--gray)">|</span>' +
            '<span class="right">正确答案：' + esc(rightTxt) + "</span>" +
          "</div>";
      } else {
        html +=
          '<div class="review-answers"><span class="my">我的作答：</span></div>' +
          '<div class="analysis-box"><pre style="white-space:pre-wrap">' + esc(val || "（未作答）") + "</pre></div>";
        if (q.refAnswer) {
          var refParas = toParagraphs(q.refAnswer, "ref");
          html +=
            '<details class="ref-answer"><summary>📖 查看参考答案</summary>' +
            '<div class="ref-answer-content">' + refParas.map(function (pt) { return "<p>" + esc(pt) + "</p>"; }).join("") + "</div></details>";
        }
      }

      if (q.analysis) {
        var ap = toParagraphs(q.analysis, "analysis");
        html += '<div class="analysis-box"><div class="analysis-title">解析</div>' + ap.map(function (pt) { return '<div class="ana-para">' + esc(pt) + "</div>"; }).join("") + "</div>";
      }
      html += "</div>";
      list.insertAdjacentHTML("beforeend", html);
    });
    if (!list.children.length) {
      list.innerHTML = '<div style="text-align:center;color:var(--gray);padding:40px 0">该筛选条件下暂无题目</div>';
    }
  }

  function resetExam(id) {
    clearLS(id);
    toast("已重置，可重新开始");
    renderHome();
  }

  /* =========================================================
     事件绑定
     ========================================================= */
  function bindEvents() {
    // 首页按钮（事件委托）
    $("#exam-list").addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      var id = t.dataset.id;
      if (t.classList.contains("start-btn")) startExam(id, false);
      else if (t.classList.contains("resume-btn")) startExam(id, true);
      else if (t.classList.contains("report-btn")) {
        state.exam = window.EXAMS.find(function (x) { return x.id === id; });
        state.flat = buildFlat(state.exam);
        var p = loadLS(id);
        state.answers = p.answers || {};
        state.flags = p.flags || [];
        state.doneResult = p.doneResult;
        renderResult();
      }
      else if (t.classList.contains("redo-btn")) startExam(id, false);
      else if (t.classList.contains("reset-btn")) resetExam(id);
    });

    $("#btn-back-home").addEventListener("click", function () {
      if (state.exam && state.exam.isRedo) { stopTimer(); renderWrongbook(); return; }
      stopTimer(); saveProgress(); renderHome();
    });
    $("#btn-result-home").addEventListener("click", function () {
      stopTimer(); renderHome();
    });
    $("#btn-wb-back").addEventListener("click", function () {
      renderHome();
    });
    $("#btn-feedback").addEventListener("click", function () {
      state.feedback = !state.feedback;
      try { localStorage.setItem("jt_feedback", state.feedback ? "1" : "0"); } catch (e) {}
      updateFeedbackBtn();
      renderQuestion();
      toast(state.feedback ? "已开启即时反馈：答一题立刻判对错并显示解析" : "已关闭即时反馈：交卷后统一判分");
    });
    $("#btn-submit").addEventListener("click", openSubmitModal);
    $("#btn-drawer-submit").addEventListener("click", openSubmitModal);
    $("#btn-cancel-submit").addEventListener("click", function () {
      $("#submit-modal").classList.add("hidden");
    });
    $("#btn-confirm-submit").addEventListener("click", function () {
      if (state.exam && state.exam.isRedo) finishRedo();
      else finishExam(false);
    });
    $("#btn-timeup-ok").addEventListener("click", function () {
      $("#timeup-modal").classList.add("hidden");
    });
    $("#btn-retry").addEventListener("click", function () {
      if (state.exam) startExam(state.exam.id, false);
    });

    // 错题本
    $("#btn-wb-open").addEventListener("click", renderWrongbook);
    $("#btn-wb-redo-all").addEventListener("click", function () {
      var wb = loadWrongbook();
      startRedo(Object.keys(wb).map(function (k) { return wb[k]; }));
    });
    $("#btn-wb-redo-all-top").addEventListener("click", function () {
      var wb = loadWrongbook();
      startRedo(Object.keys(wb).map(function (k) { return wb[k]; }));
    });
    $("#wb-list").addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      var key = t.dataset.key;
      if (!key) return;
      var wb = loadWrongbook();
      var entry = wb[key];
      if (!entry) return;
      if (t.classList.contains("wb-redo")) {
        startRedo([entry]);
      } else if (t.classList.contains("wb-del")) {
        delete wb[key];
        saveWrongbook(wb);
        toast("已从错题本移除");
        renderWrongbook();
        renderHome();
      }
    });
    $("#wb-filters").addEventListener("click", function (e) {
      var b = e.target.closest(".filter-tab");
      if (!b) return;
      $$("#wb-filters .filter-tab").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      renderWrongbook();
    });

    // 移动端答题卡抽屉
    $("#btn-open-sheet").addEventListener("click", function () {
      $("#sheet-drawer").classList.remove("hidden");
      $("#sheet-mask").classList.remove("hidden");
      renderSheet();
    });
    $("#btn-close-sheet").addEventListener("click", function () {
      $("#sheet-drawer").classList.add("hidden");
      $("#sheet-mask").classList.add("hidden");
    });
    $("#sheet-mask").addEventListener("click", function () {
      $("#sheet-drawer").classList.add("hidden");
      $("#sheet-mask").classList.add("hidden");
    });

    // 成绩页筛选
    $("#filter-tabs").addEventListener("click", function (e) {
      var b = e.target.closest(".filter-tab");
      if (!b) return;
      $$(".filter-tab").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      renderReview(b.dataset.f);
    });

    // 弹窗遮罩点击关闭
    $$(".modal-mask").forEach(function (mask) {
      mask.addEventListener("click", function (e) {
        if (e.target === mask) mask.classList.add("hidden");
      });
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    if (!window.EXAMS || !window.EXAMS.length) {
      document.body.innerHTML = "<div style='padding:40px;text-align:center'>数据加载失败，请确认 js/data.js 存在</div>";
      return;
    }
    bindEvents();
    renderHome();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
