/* global Zotero, DuxiuMetaCore */

(function () {
  "use strict";

  // Custom chrome windows don't get Zotero injected into their global scope,
  // so borrow it from the window that opened the dialog.
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
    catch (e) {
      // surfaced by the first API call
    }
  }

  var C = DuxiuMetaCore;
  var seed = (window.arguments && window.arguments[0]) || {};

  var state = {
    results: [],
    selected: null,
    selectedIndex: -1,
    searchToken: 0,
    busy: false,
    query: null,
    verifying: false,
    verifyPrompted: false,
    lastQuery: ""
  };

  function $(id) {
    return document.getElementById(id);
  }

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    $("target").textContent = "目标：" + (seed.targetLabel || "未关联条目（匹配后新建图书）");
    $("target").title = $("target").textContent;

    renderSourceToggles();

    if (seed.isbn) {
      $("query").value = seed.isbn;
    }
    else if (seed.title) {
      $("query").value = seed.title;
    }

    $("btn-search").addEventListener("click", runSearch);
    $("btn-close").addEventListener("click", function () { window.close(); });
    $("btn-apply").addEventListener("click", applySelected);
    $("btn-open").addEventListener("click", function () {
      if (state.selected && state.selected.url) {
        Zotero.launchURL(state.selected.url);
      }
    });

    $("query").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        runSearch();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        window.close();
      }
    });

    if ($("query").value.trim()) {
      runSearch();
    }
    else {
      $("query").focus();
      setStatus("输入关键词开始检索");
    }
  }

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------

  function renderSourceToggles() {
    var container = $("sourceToggles");
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
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(C.SOURCE_NAMES[source] || source));
      container.appendChild(label);
    });
  }

  function getCheckedSources() {
    var inputs = $("sourceToggles").querySelectorAll('input[type="checkbox"]');
    var sources = [];
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].checked) {
        sources.push(inputs[i].value);
      }
    }
    return sources;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  async function runSearch(force) {
    if (state.busy && !force) {
      return;
    }
    var text = $("query").value.trim();
    if (!text) {
      $("query").focus();
      return;
    }
    if (text !== state.lastQuery) {
      state.lastQuery = text;
      state.verifyPrompted = false;
    }
    var sources = getCheckedSources();
    if (!sources.length) {
      setStatus("请至少选择一个来源");
      return;
    }

    var token = ++state.searchToken;
    state.busy = true;
    setLoading(true);
    setStatus("正在检索 " + sources.map(function (source) {
      return C.SOURCE_NAMES[source] || source;
    }).join(" / ") + "…");
    $("count").textContent = "";

    var isIsbn = C.looksLikeISBN(text);
    state.query = {
      isbn: isIsbn ? C.normalizeISBN(text) : (C.normalizeISBN(seed.isbn) || ""),
      title: isIsbn ? "" : text,
      authors: seed.authors || [],
      year: seed.year || "",
      publisher: seed.publisher || ""
    };

    try {
      var outcome = await Zotero.DuxiuMeta.searchAll({
        text: text,
        hintIsbn: seed.isbn || "",
        authors: seed.authors || [],
        year: seed.year || "",
        publisher: seed.publisher || ""
      }, {
        sources: sources,
        onPartial: function (partial, partialErrors) {
          if (token !== state.searchToken) {
            return;
          }
          $("loading").hidden = true;
          state.results = partial;
          renderResults(false);
          renderErrors(partialErrors);
          maybePromptVerification(partialErrors);
          setStatus("正在检索… 已找到 " + partial.length + " 条");
        }
      });

      if (token !== state.searchToken) {
        return;
      }

      state.results = outcome.results || [];
      if (outcome.query) {
        state.query = outcome.query;
      }
      renderErrors(outcome.errors || []);
      maybePromptVerification(outcome.errors || []);
      renderResults(true);
      setStatus(state.results.length ? "检索完成" : "没有找到结果");
    }
    catch (error) {
      if (token === state.searchToken) {
        renderErrors([{ source: "search", message: String((error && error.message) || error) }]);
        setStatus("检索失败");
      }
    }
    finally {
      if (token === state.searchToken) {
        state.busy = false;
        setLoading(false);
      }
    }
  }

  function setLoading(loading) {
    $("loading").hidden = !loading;
    $("btn-search").disabled = loading;
  }

  function setStatus(text) {
    $("status").textContent = text;
  }

  function maybePromptVerification(errors) {
    if (state.verifyPrompted) {
      return;
    }
    var error = (errors || []).filter(function (item) {
      return item && item.needsVerification;
    })[0];
    if (!error) {
      return;
    }
    state.verifyPrompted = true;
    setTimeout(function () {
      requestVerification(error);
    }, 0);
  }

  async function requestVerification(error) {
    if (state.verifying) {
      return;
    }
    state.verifying = true;
    setStatus("等待豆瓣验证…");
    try {
      var ok = await Zotero.DuxiuMeta.openVerification(
        (error && error.verifyURL) || "https://www.douban.com/"
      );
      if (ok) {
        runSearch(true);
      }
      else {
        setStatus("验证窗口已关闭；可点击错误提示里的「打开豆瓣验证」重试");
      }
    }
    catch (e) {
      setStatus("无法打开验证窗口");
      Zotero.debug("[DuxiuMeta] verification window failed: " + e);
    }
    finally {
      state.verifying = false;
    }
  }

  function renderErrors(errors) {
    var container = $("errors");
    container.textContent = "";
    if (!errors.length) {
      container.hidden = true;
      return;
    }
    errors.forEach(function (error) {
      var line = document.createElement("div");
      line.className = "error-line";
      var name = C.SOURCE_NAMES[error.source] || error.source;
      var strong = document.createElement("b");
      strong.textContent = name + "：";
      line.appendChild(strong);
      line.appendChild(document.createTextNode(error.message || "请求失败"));
      if (error.needsVerification) {
        var action = document.createElement("button");
        action.type = "button";
        action.className = "inline-action";
        action.textContent = "打开豆瓣验证";
        action.addEventListener("click", function () {
          requestVerification(error);
        });
        line.appendChild(action);
      }
      container.appendChild(line);
    });
    container.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Result list
  // ---------------------------------------------------------------------------

  function renderResults(autoSelect) {
    var previousUrl = state.selected && state.selected.url;
    var list = $("results");
    list.textContent = "";

    $("count").textContent = state.results.length ? state.results.length + " 条" : "";
    $("empty").hidden = state.results.length > 0;

    state.results.forEach(function (result, index) {
      var row = document.createElement("li");
      row.className = "result";
      row.dataset.index = String(index);

      var main = document.createElement("div");
      main.className = "result-main";

      var title = document.createElement("div");
      title.className = "result-title";
      title.textContent = C.toBookFields(result).title || "(无标题)";
      main.appendChild(title);

      var metaBits = [];
      if (result.authors && result.authors.length) {
        metaBits.push(result.authors.slice(0, 3).join("、"));
      }
      if (result.publisher) {
        metaBits.push(result.publisher);
      }
      var year = C.extractYear(result.date);
      if (year) {
        metaBits.push(year);
      }
      if (result.isbn) {
        metaBits.push("ISBN " + C.formatISBN(result.isbn));
      }
      var meta = document.createElement("div");
      meta.className = "result-meta";
      meta.textContent = metaBits.join(" · ") || "（搜索结果）";
      main.appendChild(meta);

      var side = document.createElement("div");
      side.className = "result-side";

      var badge = document.createElement("span");
      badge.className = "badge";
      badge.dataset.source = result.source;
      badge.textContent = C.SOURCE_NAMES[result.source] || result.source;
      side.appendChild(badge);

      var score = document.createElement("span");
      score.className = "score" + (result.score >= 0.85 ? " high" : "");
      score.textContent = Math.round((result.score || 0) * 100) + "%";
      side.appendChild(score);

      row.appendChild(main);
      row.appendChild(side);

      row.addEventListener("click", function () {
        select(index);
      });
      row.addEventListener("dblclick", function () {
        select(index);
        applySelected();
      });

      list.appendChild(row);
    });

    if (!state.results.length) {
      state.selected = null;
      state.selectedIndex = -1;
      updateDetail(null);
      return;
    }

    if (previousUrl) {
      var keep = -1;
      for (var i = 0; i < state.results.length; i++) {
        if (state.results[i].url === previousUrl) {
          keep = i;
          break;
        }
      }
      if (keep >= 0) {
        select(keep);
        return;
      }
    }

    if (autoSelect) {
      select(0);
    }
    else {
      state.selected = null;
      state.selectedIndex = -1;
      updateDetail(null);
    }
  }

  function updateRowScore(index, score) {
    var row = $("results").querySelector('.result[data-index="' + index + '"]');
    if (!row) {
      return;
    }
    var element = row.querySelector(".score");
    if (!element) {
      return;
    }
    element.textContent = Math.round((score || 0) * 100) + "%";
    element.classList.toggle("high", (score || 0) >= 0.85);
  }

  async function select(index) {
    var result = state.results[index];
    if (!result) {
      return;
    }
    state.selected = result;
    state.selectedIndex = index;

    var rows = $("results").querySelectorAll(".result");
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("selected", i === index);
    }

    updateDetail(result);
    $("btn-apply").disabled = false;
    $("btn-open").disabled = !result.url;

    if (result.enriched || result._enriching) {
      return;
    }
    result._enriching = true;
    $("dEnriching").hidden = false;
    try {
      await Zotero.DuxiuMeta.enrichResult(result);
    }
    catch (e) {
      Zotero.debug("[DuxiuMeta] enrich failed: " + e);
    }
    result._enriching = false;
    if (state.selected === result) {
      if (state.query) {
        result.score = C.scoreResult(result, state.query);
        var index = state.results.indexOf(result);
        if (index >= 0) {
          updateRowScore(index, result.score);
        }
      }
      $("dEnriching").hidden = true;
      updateDetail(result);
    }
  }

  function updateDetail(result) {
    if (!result) {
      $("detailEmpty").hidden = false;
      $("detailContent").hidden = true;
      $("btn-apply").disabled = true;
      $("btn-open").disabled = true;
      return;
    }

    $("detailEmpty").hidden = true;
    $("detailContent").hidden = false;

    var fields = C.toBookFields(result);
    $("dSource").textContent = C.SOURCE_NAMES[result.source] || result.source;
    $("dSource").dataset.source = result.source;
    $("dScore").textContent = "匹配度 " + Math.round((result.score || 0) * 100) + "%";
    $("dScore").classList.toggle("high", (result.score || 0) >= 0.85);

    $("dTitle").textContent = fields.title || "(无标题)";

    var subBits = [];
    if (result.authors && result.authors.length) {
      subBits.push(result.authors.join("、"));
    }
    if (result.publisher) {
      subBits.push(result.publisher);
    }
    var year = C.extractYear(result.date);
    if (year) {
      subBits.push(year);
    }
    $("dSub").textContent = subBits.join(" · ");

    var meta = $("dMeta");
    meta.textContent = "";

    function addRow(label, value, isLink) {
      if (!value) {
        return;
      }
      var dt = document.createElement("dt");
      dt.textContent = label;
      var dd = document.createElement("dd");
      if (isLink) {
        var anchor = document.createElement("a");
        anchor.href = value;
        anchor.textContent = value;
        anchor.addEventListener("click", function (event) {
          event.preventDefault();
          Zotero.launchURL(value);
        });
        dd.appendChild(anchor);
      }
      else {
        dd.textContent = value;
      }
      meta.appendChild(dt);
      meta.appendChild(dd);
    }

    addRow("作者", (result.authors || []).join("、"));
    addRow("译者", (result.translators || []).join("、"));
    addRow("出版社", result.publisher);
    addRow("出版年", C.normalizeDate(result.date));
    addRow("页数", result.numPages ? String(result.numPages) : "");
    addRow("ISBN", result.isbn ? C.formatISBN(result.isbn) : "");
    addRow("丛书", result.series);
    addRow("来源", C.SOURCE_NAMES[result.source] || result.source);
    addRow("链接", result.url, true);

    var abstract = fields.abstractNote || "";
    $("dAbstractBox").hidden = !abstract;
    $("dAbstract").textContent = abstract;
  }

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------

  async function applySelected() {
    if (!state.selected || state.busy) {
      return;
    }
    var result = state.selected;
    state.busy = true;
    $("btn-apply").disabled = true;
    setStatus("正在应用元数据…");

    try {
      await Zotero.DuxiuMeta.enrichResult(result);
      var outcome = await Zotero.DuxiuMeta.applyResult(result, {
        itemID: seed.itemID || null,
        attachmentID: seed.attachmentID || null
      }, {
        overwrite: $("overwrite").checked
      });

      if (outcome && outcome.created) {
        setStatus("已新建图书条目并应用元数据");
      }
      else {
        setStatus("元数据已应用到现有条目");
      }
      setTimeout(function () { window.close(); }, 900);
    }
    catch (error) {
      setStatus("应用失败");
      renderErrors([{ source: "apply", message: String((error && error.message) || error) }]);
      $("btn-apply").disabled = false;
      state.busy = false;
    }
  }
})();
