/* global Zotero, DuxiuMetaCore */

(function () {
  "use strict";

  if (typeof Zotero === "undefined") {
    try {
      if (window.opener && window.opener.Zotero) {
        window.Zotero = window.opener.Zotero;
      }
      else {
        window.Zotero = Components.classes["@zotero.org/Zotero;1"]
          .getService(Components.interfaces.nsISupports).wrappedJSObject;
      }
    }
    catch (e) {}
  }

  var C = DuxiuMetaCore;
  var seed = (window.arguments && window.arguments[0]) || {};

  var state = {
    rows: [],
    sources: [],
    scanning: false,
    applying: false,
    cancel: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    $("collection").textContent = "分类：" + (seed.collectionName || "(未选择)");
    renderSources();
    bind();
    if (seed.collectionID) {
      await reloadRows();
    }
    else {
      setStatus("请从左侧分类右键打开批量匹配");
    }
  }

  function bind() {
    $("btn-scan").addEventListener("click", scanAll);
    $("btn-stop").addEventListener("click", function () {
      state.cancel = true;
      setStatus("正在停止…");
    });
    $("btn-apply").addEventListener("click", applyAll);
    $("btn-close").addEventListener("click", function () { window.close(); });
    $("recursive").addEventListener("change", reloadRows);
    $("onlyMissing").addEventListener("change", applyOnlyMissing);
    $("btn-all").addEventListener("click", function () { setAllChecked(true); });
    $("btn-none").addEventListener("click", function () { setAllChecked(false); });
  }

  function renderSources() {
    var container = $("sources");
    var enabled = [];
    try {
      enabled = Zotero.DuxiuMeta.getEnabledSources();
    }
    catch (e) {
      enabled = C.SOURCE_ORDER.slice();
    }
    C.SOURCE_ORDER.forEach(function (source) {
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = source;
      checkbox.checked = enabled.indexOf(source) !== -1;
      checkbox.addEventListener("change", updateSummary);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(C.SOURCE_NAMES[source] || source));
      container.appendChild(label);
    });
  }

  function getCheckedSources() {
    var inputs = $("sources").querySelectorAll('input[type="checkbox"]');
    var sources = [];
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].checked) {
        sources.push(inputs[i].value);
      }
    }
    return sources;
  }

  function setStatus(text) {
    $("status").textContent = text;
  }

  function setRowStatus(row, text, cls) {
    row.statusEl.textContent = text;
    row.statusEl.className = "row-status " + (cls || "");
  }

  // ---------------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------------

  async function reloadRows() {
    if (state.scanning || state.applying) {
      return;
    }
    setStatus("正在读取分类…");
    $("rows").textContent = "";
    state.rows = [];
    try {
      var list = await Zotero.DuxiuMeta.getCollectionPDFs(seed.collectionID, $("recursive").checked);
      state.rows = list.map(buildRow);
      renderRows();
      setStatus(list.length ? "共 " + list.length + " 个 PDF" : "这个分类里没有 PDF");
    }
    catch (e) {
      setStatus("读取分类失败：" + (e.message || e));
    }
    updateSummary();
  }

  function buildRow(desc) {
    var li = document.createElement("li");
    li.className = "batch-row";

    var checkCell = document.createElement("div");
    checkCell.className = "cell check-cell";
    var check = document.createElement("input");
    check.type = "checkbox";
    check.checked = true;
    check.addEventListener("change", updateSummary);
    checkCell.appendChild(check);

    var fileCell = document.createElement("div");
    fileCell.className = "cell file-cell";
    var filename = document.createElement("div");
    filename.className = "filename";
    filename.textContent = desc.filename || "(未知文件)";
    filename.title = desc.filename || "";
    var current = document.createElement("div");
    current.className = "current-title";
    current.textContent = desc.title ? "当前：" + desc.title : "独立 PDF，匹配后新建图书";
    fileCell.appendChild(filename);
    fileCell.appendChild(current);

    var isbnCell = document.createElement("div");
    isbnCell.className = "cell isbn-cell";
    isbnCell.textContent = desc.isbn ? C.formatISBN(desc.isbn) : "—";

    var candidateCell = document.createElement("div");
    candidateCell.className = "cell candidate-cell";
    var select = document.createElement("select");
    select.disabled = true;
    var option = document.createElement("option");
    option.textContent = "待识别";
    select.appendChild(option);
    var meta = document.createElement("div");
    meta.className = "candidate-meta";
    candidateCell.appendChild(select);
    candidateCell.appendChild(meta);

    var status = document.createElement("div");
    status.className = "cell row-status pending";
    status.textContent = "待识别";

    li.appendChild(checkCell);
    li.appendChild(fileCell);
    li.appendChild(isbnCell);
    li.appendChild(candidateCell);
    li.appendChild(status);

    var row = {
      desc: desc,
      li: li,
      check: check,
      isbnEl: isbnCell,
      select: select,
      metaEl: meta,
      statusEl: status,
      candidates: [],
      selected: 0,
      applied: false,
      aiUsed: false
    };

    select.addEventListener("change", function () {
      row.selected = parseInt(select.value, 10) || 0;
      updateCandidate(row);
      if (row.candidates[row.selected]) {
        setRowStatus(row, (row.aiUsed ? "AI 选择 · " : "") + Math.round(row.candidates[row.selected].score * 100) + "%", "matched");
      }
    });

    return row;
  }

  function renderRows() {
    var container = $("rows");
    container.textContent = "";
    state.rows.forEach(function (row) {
      container.appendChild(row.li);
    });
    $("empty").hidden = state.rows.length > 0;
    updateSummary();
    updateApplyState();
  }

  function updateSummary() {
    var total = state.rows.length;
    var checked = state.rows.filter(function (row) { return row.check.checked && !row.applied; }).length;
    var matched = state.rows.filter(function (row) { return row.candidates.length && !row.applied; }).length;
    var applied = state.rows.filter(function (row) { return row.applied; }).length;
    $("summary").textContent = "共 " + total + " · 已选 " + checked + " · 已匹配 " + matched
      + (applied ? " · 已应用 " + applied : "");
    updateApplyState();
  }

  function updateApplyState() {
    var applicable = state.rows.filter(function (row) {
      return row.check.checked && row.candidates.length && !row.applied;
    }).length;
    $("btn-apply").disabled = applicable === 0 || state.applying || state.scanning;
  }

  function applyOnlyMissing() {
    var onlyMissing = $("onlyMissing").checked;
    state.rows.forEach(function (row) {
      if (row.applied) {
        return;
      }
      row.check.checked = onlyMissing ? !row.desc.isbn : true;
    });
    updateSummary();
  }

  function setAllChecked(checked) {
    state.rows.forEach(function (row) {
      if (!row.applied) {
        row.check.checked = checked;
      }
    });
    updateSummary();
  }

  function updateCandidate(row) {
    var candidate = row.candidates[row.selected];
    if (!candidate) {
      row.metaEl.textContent = "";
      return;
    }
    var bits = [];
    if (candidate.authors && candidate.authors.length) {
      bits.push(candidate.authors.slice(0, 2).join("、"));
    }
    if (candidate.publisher) {
      bits.push(candidate.publisher);
    }
    var year = C.extractYear(candidate.date);
    if (year) {
      bits.push(year);
    }
    if (candidate.isbn) {
      bits.push("ISBN " + C.formatISBN(candidate.isbn));
    }
    bits.push((C.SOURCE_NAMES[candidate.source] || candidate.source) + " · " + Math.round((candidate.score || 0) * 100) + "%");
    row.metaEl.textContent = bits.join(" · ");
    row.metaEl.title = row.metaEl.textContent;
  }

  function fillCandidates(row) {
    var select = row.select;
    select.textContent = "";
    if (!row.candidates.length) {
      var emptyOption = document.createElement("option");
      emptyOption.textContent = "（无候选）";
      select.appendChild(emptyOption);
      select.disabled = true;
      row.metaEl.textContent = "";
      return;
    }

    row.candidates.forEach(function (candidate, index) {
      var option = document.createElement("option");
      option.value = String(index);
      var title = C.toBookFields(candidate).title || "(无标题)";
      if (title.length > 70) {
        title = title.slice(0, 70) + "…";
      }
      option.textContent = title + " · " + (C.SOURCE_NAMES[candidate.source] || candidate.source);
      select.appendChild(option);
    });
    select.value = String(row.selected);
    select.disabled = false;
    updateCandidate(row);
  }

  // ---------------------------------------------------------------------------
  // Recognition
  // ---------------------------------------------------------------------------

  async function scanAll() {
    if (state.scanning || state.applying) {
      return;
    }
    var rows = state.rows.filter(function (row) {
      return row.check.checked && !row.applied;
    });
    if (!rows.length) {
      setStatus("请先勾选要识别的 PDF");
      return;
    }

    state.sources = getCheckedSources();
    if (!state.sources.length) {
      setStatus("请至少选择一个检索来源");
      return;
    }

    state.scanning = true;
    state.cancel = false;
    $("btn-scan").disabled = true;
    $("btn-stop").disabled = false;
    $("btn-apply").disabled = true;

    var cursor = 0;
    var done = 0;

    async function worker() {
      while (!state.cancel) {
        var index = cursor++;
        if (index >= rows.length) {
          return;
        }
        await scanRow(rows[index]);
        done++;
        setStatus("识别中 " + done + " / " + rows.length + "…");
        updateSummary();
      }
    }

    await Promise.all([worker(), worker()]);

    state.scanning = false;
    $("btn-scan").disabled = false;
    $("btn-stop").disabled = true;
    setStatus(state.cancel ? "已停止" : "识别完成，请确认结果后应用");
    updateSummary();
  }

  async function scanRow(row) {
    setRowStatus(row, "识别中…", "scanning");
    try {
      var isbn = row.desc.isbn;
      if (!isbn) {
        isbn = await Zotero.DuxiuMeta.getPDFISBN(row.desc.attachmentID);
        if (isbn) {
          row.isbnEl.textContent = C.formatISBN(isbn);
        }
      }

      var title = row.desc.title || C.titleFromFilename(row.desc.filename);
      if (!isbn && !title) {
        setRowStatus(row, "缺少书名和 ISBN", "empty");
        return;
      }
      row.desc.isbn = isbn;
      row.desc.title = row.desc.title || title;

      var query = {
        hintIsbn: isbn,
        authors: row.desc.authors,
        year: row.desc.year,
        publisher: row.desc.publisher
      };

      // If the PDF gave us an ISBN, search by it first. Searching by a noisy
      // filename would otherwise pick a different edition with a similar title.
      var outcome = await Zotero.DuxiuMeta.searchAll(Object.assign({ text: isbn || title }, query), {
        sources: state.sources
      });
      if (isbn && title && (!outcome.results || !outcome.results.length)) {
        outcome = await Zotero.DuxiuMeta.searchAll(Object.assign({ text: title }, query), {
          sources: state.sources
        });
      }

      var pool = (outcome.results || []).slice(0, 6);

      // With an ISBN in hand, check the ISBN of the top records before deciding.
      // Douban's search result doesn't include ISBN, so a detail fetch is the
      // only way to tell the exact edition from a similar title.
      if (isbn) {
        for (var k = 0; k < Math.min(pool.length, 3); k++) {
          if (!pool[k].isbn) {
            try {
              await Zotero.DuxiuMeta.enrichResult(pool[k]);
            }
            catch (e) {}
          }
        }
        pool.forEach(function (result) {
          result.score = C.scoreResult(result, { isbn: isbn });
        });
        pool.sort(function (a, b) { return b.score - a.score; });
      }

      var candidates = pool.filter(function (result) {
        return result.score >= 0.45;
      }).slice(0, 3);

      if (!candidates.length) {
        row.candidates = [];
        fillCandidates(row);
        setRowStatus(row, "未找到", "empty");
        return;
      }

      row.candidates = candidates;
      row.selected = 0;
      row.aiUsed = false;

      if (typeof Zotero.DuxiuMeta.aiPickCandidate === "function" && candidates.length > 1) {
        try {
          var ai = await Zotero.DuxiuMeta.aiPickCandidate(row.desc, candidates);
          if (ai && typeof ai.index === "number" && candidates[ai.index]) {
            row.selected = ai.index;
            row.aiUsed = true;
          }
        }
        catch (e) {
          Zotero.debug("[DuxiuMeta] AI pick failed: " + e);
        }
      }

      fillCandidates(row);
      setRowStatus(row, (row.aiUsed ? "AI 选择 · " : "") + Math.round(candidates[row.selected].score * 100) + "%", "matched");
    }
    catch (e) {
      setRowStatus(row, "失败：" + String(e.message || e).slice(0, 24), "error");
    }
  }

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------

  async function applyAll() {
    if (state.applying || state.scanning) {
      return;
    }
    var rows = state.rows.filter(function (row) {
      return row.check.checked && row.candidates.length && !row.applied;
    });
    if (!rows.length) {
      setStatus("没有可应用的条目");
      return;
    }

    var message = "将覆盖 " + rows.length + " 个条目的元数据（标题、作者、出版社、年份、ISBN 等）。\n\n"
      + "如果 PDF 还没有父条目，会自动新建图书条目。确定继续？";
    var confirmed = true;
    try {
      confirmed = Zotero.getMainWindow().confirm(message);
    }
    catch (e) {
      confirmed = window.confirm(message);
    }
    if (!confirmed) {
      return;
    }

    state.applying = true;
    $("btn-apply").disabled = true;
    $("btn-scan").disabled = true;

    var ok = 0;
    var failed = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      setRowStatus(row, "应用中…", "scanning");
      setStatus("正在应用 " + (i + 1) + " / " + rows.length + "…");
      try {
        var candidate = row.candidates[row.selected];
        await Zotero.DuxiuMeta.enrichResult(candidate);
        await Zotero.DuxiuMeta.applyResult(candidate, {
          itemID: row.desc.itemID,
          attachmentID: row.desc.attachmentID
        }, { overwrite: true });

        row.applied = true;
        row.check.checked = false;
        row.check.disabled = true;
        row.select.disabled = true;
        setRowStatus(row, "已应用", "applied");
        ok++;
      }
      catch (e) {
        setRowStatus(row, "应用失败", "error");
        failed++;
      }
      updateSummary();
    }

    state.applying = false;
    $("btn-scan").disabled = false;
    setStatus("完成：成功 " + ok + " 个" + (failed ? "，失败 " + failed + " 个" : ""));
    updateSummary();
  }
})();
