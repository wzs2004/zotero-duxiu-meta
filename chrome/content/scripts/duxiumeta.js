/* global Zotero, Services, Components, ChromeUtils */

/**
 * Duxiu Meta - Zotero integration.
 *
 * Loaded after core.js into the plugin sandbox. Everything public hangs off
 * Zotero.DuxiuMeta so that the search dialog and the preference pane can call
 * into it from their own chrome windows.
 */

(function () {
  "use strict";

  var C = DuxiuMetaCore;

  var PREF_BRANCH = "extensions.zotero.duxiumeta.";
  var PLUGIN_ID = "duxiumeta@duxiumeta.github.io";
  var PANE_ID = "duxiumeta-prefs";
  var MENU_ID = "duxiumeta-itemmenu";
  var COLLECTION_MENU_ID = "duxiumeta-collectionmenu";
  var DIALOG_URL = "chrome://duxiumeta/content/search.xhtml";
  var ICON_URL = "chrome://duxiumeta/content/icons/icon.png";

  var rootURI = "";
  var notifierID = null;
  var autoTimer = null;
  var pendingAuto = new Map();
  var verifyState = { url: "", resolve: null };
  var debug = false;

  var DEFAULT_DUXIU_URL = "https://www.duxiu.com/search?channel=search&sw={query}&ecode=utf-8";

  // ---------------------------------------------------------------------------
  // Preferences
  // ---------------------------------------------------------------------------

  function getPref(key, fallback) {
    try {
      var value = Zotero.Prefs.get(PREF_BRANCH + key, true);
      if (value === undefined || value === null) {
        return fallback;
      }
      return value;
    }
    catch (e) {
      return fallback;
    }
  }

  function getBool(key, fallback) {
    var value = getPref(key, fallback);
    if (typeof value === "string") {
      return value !== "false" && value !== "0" && value !== "";
    }
    return !!value;
  }

  function getNumber(key, fallback) {
    var value = parseInt(getPref(key, fallback), 10);
    return isNaN(value) ? fallback : value;
  }

  function log(message) {
    if (debug || getBool("debug", false)) {
      Zotero.debug("[DuxiuMeta] " + message);
    }
  }

  function safeGetField(item, field) {
    try {
      return item.getField(field) || "";
    }
    catch (e) {
      return "";
    }
  }

  function getEnabledSources() {
    return C.SOURCE_ORDER.filter(function (source) {
      return getBool("sources." + source, true);
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP / parsing
  // ---------------------------------------------------------------------------

  function parseHTML(html) {
    var win = Zotero.getMainWindow();
    var Parser = (win && win.DOMParser) || (typeof DOMParser !== "undefined" ? DOMParser : null);
    if (Parser) {
      try {
        return new Parser().parseFromString(html, "text/html");
      }
      catch (e) {
        log("DOMParser failed: " + e);
      }
    }
    var doc = win.document.implementation.createHTMLDocument("duxiumeta");
    doc.documentElement.innerHTML = html;
    return doc;
  }

  async function httpRequest(url, options) {
    options = options || {};
    var timeout = options.timeout || 15000;
    log("GET " + url);
    var xhr = await Zotero.HTTP.request("GET", url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      },
      responseType: "text",
      timeout: timeout,
      successCodes: false,
      followRedirects: true,
      errorDelayMax: 20000
    });
    if (debug) {
      log("response " + String(xhr.responseText || "").length + " chars from " + url + " (status " + xhr.status + ")");
    }
    return xhr;
  }

  async function httpGet(url, options) {
    var xhr = await httpRequest(url, options);
    if (xhr.status && (xhr.status < 200 || xhr.status >= 400)) {
      throw new Error("HTTP " + xhr.status + " " + (xhr.statusText || ""));
    }
    return xhr.responseText || "";
  }

  function isDoubanChallenge(html, responseURL, status) {
    if (status === 403) {
      return true;
    }
    if (/sec\.douban\.com/i.test(String(responseURL || ""))) {
      return true;
    }
    return /sec\.douban\.com|captcha|异常请求|检测到有异常|人机验证/i.test(String(html || ""));
  }

  function friendlyError(error) {
    var message = String((error && error.message) || error || "未知错误");
    if (/timeout|timed out/i.test(message)) {
      return "请求超时（网络较慢或被屏蔽）";
    }
    if (/NS_ERROR_|NetworkError|Load failed/i.test(message)) {
      return "网络请求失败（可能被屏蔽，或需要代理）";
    }
    return message;
  }

  // ---------------------------------------------------------------------------
  // Metadata sources
  // ---------------------------------------------------------------------------

  async function searchDuxiu(request) {
    var query = request.isbn || request.title;
    if (!query) {
      return [];
    }
    var template = String(getPref("duxiu.searchURL", DEFAULT_DUXIU_URL) || DEFAULT_DUXIU_URL);
    var url = template.indexOf("{query}") === -1
      ? template + encodeURIComponent(query)
      : template.replace(/\{query\}/g, encodeURIComponent(query));
    var timeout = getNumber("duxiu.timeout", 15000);
    var html = await httpGet(url, { timeout: timeout });
    var doc = parseHTML(html);
    var results = C.parseDuxiuSearch(doc, getPref("duxiu.linkSelector", ""));

    if (!results.length) {
      if (/请登录|登录后|机构用户|IP\s*地址|访问受限|验证码|身份认证/.test(html)) {
        throw new Error("读秀要求登录或机构权限：请连接学校/机构网络（或 VPN）后重试。");
      }
      throw new Error("读秀页面中没有解析到图书，可能需要在机构 IP 内访问，或页面结构已变化。");
    }
    return results.slice(0, request.maxResults);
  }

  async function searchWenjin(request) {
    var query = request.isbn || request.title;
    if (!query) {
      return [];
    }
    var url = new URL("http://find.nlc.cn/search/doSearch");
    url.searchParams.set("query", query);
    url.searchParams.set("secQuery", "");
    url.searchParams.set("actualQuery", query);
    url.searchParams.set("searchType", "2");
    url.searchParams.set("docType", "全部");
    url.searchParams.set("isGroup", "isGroup");
    url.searchParams.set("targetFieldLog", "全部字段");
    url.searchParams.set("orderBy", "RELATIVE");

    var html = await httpGet(url.href, { timeout: 15000 });
    if (/访问受限|验证码|请输入验证码/.test(html)) {
      throw new Error("文津要求人机验证，请稍后再试。");
    }
    return C.parseWenjinSearch(parseHTML(html)).slice(0, request.maxResults);
  }

  async function searchDouban(request) {
    var query = request.isbn || request.title;
    if (!query) {
      return [];
    }
    var url = "https://www.douban.com/search?cat=1001&q=" + encodeURIComponent(query);
    var xhr = await httpRequest(url, { timeout: 15000 });
    var responseURL = xhr.responseURL || url;
    var html = xhr.responseText || "";

    if (isDoubanChallenge(html, responseURL, xhr.status)) {
      var challenge = new Error("豆瓣要求人机验证");
      challenge.needsVerification = true;
      challenge.verifyURL = responseURL;
      throw challenge;
    }
    if (xhr.status && (xhr.status < 200 || xhr.status >= 400)) {
      throw new Error("HTTP " + xhr.status + " " + (xhr.statusText || ""));
    }

    var results = C.parseDoubanSearch(parseHTML(html));
    if (!results.length) {
      throw new Error("豆瓣没有返回图书结果。");
    }
    return results.slice(0, request.maxResults);
  }

  async function searchGoogle(request) {
    var query = request.isbn ? "isbn:" + request.isbn : request.title;
    if (!query) {
      return [];
    }
    var url = "https://www.googleapis.com/books/v1/volumes?q=" + encodeURIComponent(query)
      + "&maxResults=" + request.maxResults + "&printType=books";
    var text = await httpGet(url, { timeout: 15000 });
    var json;
    try {
      json = JSON.parse(text);
    }
    catch (e) {
      throw new Error("Google Books 返回的不是 JSON（可能需要代理）。");
    }
    return C.parseGoogleBooks(json).slice(0, request.maxResults);
  }

  async function searchOpenLibrary(request) {
    var query = request.isbn || request.title;
    if (!query) {
      return [];
    }
    var fields = "key,title,subtitle,author_name,first_publish_year,publisher,isbn,number_of_pages_median,language,cover_i";
    var url = "https://openlibrary.org/search.json?q=" + encodeURIComponent(query)
      + "&limit=" + request.maxResults + "&fields=" + fields;
    var text = await httpGet(url, { timeout: 15000 });
    var json;
    try {
      json = JSON.parse(text);
    }
    catch (e) {
      throw new Error("Open Library 返回数据解析失败。");
    }
    return C.parseOpenLibrary(json).slice(0, request.maxResults);
  }

  var SOURCES = {
    duxiu: searchDuxiu,
    wenjin: searchWenjin,
    douban: searchDouban,
    google: searchGoogle,
    openlibrary: searchOpenLibrary
  };

  /**
   * Search all enabled sources.
   * @param {Object} query {text, hintIsbn, authors, year, publisher}
   * @param {Object} [options] {sources, maxResults}
   * @returns {Promise<{results: Array, errors: Array, query: Object}>}
   */
  async function searchAll(query, options) {
    options = options || {};
    var text = C.cleanText(query.text);
    var textIsISBN = C.looksLikeISBN(text);
    var textISBN = textIsISBN ? C.normalizeISBN(text) : "";
    var hintISBN = C.normalizeISBN(query.hintIsbn);

    // When the user types a title we search by that title; the ISBN extracted
    // from the PDF is then only used for scoring. When the box is empty (auto
    // mode) we search by the extracted ISBN.
    var request = {
      isbn: textISBN || (!text ? hintISBN : ""),
      title: textIsISBN ? "" : text,
      authors: query.authors || [],
      year: query.year || "",
      publisher: query.publisher || "",
      maxResults: Math.max(5, Math.min(40, options.maxResults || getNumber("maxResults", 20)))
    };

    var sources = (options.sources && options.sources.length ? options.sources : getEnabledSources())
      .filter(function (source) {
        return !!SOURCES[source];
      });

    var errors = [];
    var partialResults = [];
    var scoringQuery = {
      isbn: textISBN || hintISBN,
      title: textIsISBN ? "" : text,
      authors: request.authors,
      year: request.year,
      publisher: request.publisher
    };

    function publishPartial() {
      if (typeof options.onPartial !== "function") {
        return;
      }
      try {
        var snapshot = C.scoreAndSort(
          C.dedupeResults(partialResults.slice()),
          Object.assign({}, scoringQuery)
        );
        options.onPartial(snapshot, errors.slice());
      }
      catch (e) {
        log("onPartial failed: " + e);
      }
    }

    var tasks = sources.map(function (source) {
      return SOURCES[source](request).then(function (results) {
        partialResults = partialResults.concat(results);
        publishPartial();
        return { source: source, results: results };
      }).catch(function (error) {
        var info = { source: source, message: friendlyError(error) };
        if (error && error.needsVerification) {
          info.needsVerification = true;
          info.verifyURL = error.verifyURL || "";
        }
        errors.push(info);
        log(source + " failed: " + error);
        publishPartial();
        return { source: source, results: [] };
      });
    });

    var settled = await Promise.all(tasks);
    var results = [];
    settled.forEach(function (entry) {
      results = results.concat(entry.results);
    });

    results = C.dedupeResults(results);
    C.scoreAndSort(results, scoringQuery);

    return { results: results, errors: errors, request: request, query: scoringQuery };
  }

  /**
   * Lazily fetch a detail page to fill in ISBN, pages, abstract, etc.
   */
  async function enrichResult(result) {
    if (!result || result.enriched) {
      return result;
    }
    if (result._enrichPromise) {
      return result._enrichPromise;
    }

    result._enrichPromise = (async function () {
      if (result.source === "douban" && result.url) {
        try {
          var doubanHTML = await httpGet(result.url, { timeout: 15000 });
          C.mergeResult(result, C.parseDoubanDetail(parseHTML(doubanHTML)));
        }
        catch (e) {
          log("douban detail failed: " + e);
        }
      }
      else if (result.source === "wenjin" && result.url) {
        try {
          var wenjinHTML = await httpGet(result.url, { timeout: 15000 });
          C.mergeResult(result, C.parseWenjinDetail(parseHTML(wenjinHTML), result.url));
        }
        catch (e) {
          log("wenjin detail failed: " + e);
        }
      }
      else if (result.source === "duxiu" && result.url) {
        try {
          var duxiuHTML = await httpGet(result.url, { timeout: 15000 });
          var detail = C.parseDuxiuDetail(parseHTML(duxiuHTML), result.url);
          if (!/登录|login/i.test(detail.title || "")) {
            C.mergeResult(result, detail);
          }
        }
        catch (e) {
          log("duxiu detail failed: " + e);
        }
      }
      result.enriched = true;
      return result;
    })();

    try {
      return await result._enrichPromise;
    }
    finally {
      delete result._enrichPromise;
    }
  }

  // ---------------------------------------------------------------------------
  // Selection / target handling
  // ---------------------------------------------------------------------------

  function getMainWindows() {
    if (typeof Zotero.getMainWindows === "function") {
      try {
        return Zotero.getMainWindows();
      }
      catch (e) {}
    }
    var windows = [];
    var enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      var win = enumerator.getNext();
      if (win.ZoteroPane) {
        windows.push(win);
      }
    }
    return windows;
  }

  function getSelectedItems() {
    try {
      var pane = Zotero.getActiveZoteroPane();
      return pane ? pane.getSelectedItems() : [];
    }
    catch (e) {
      return [];
    }
  }

  function resolveTarget(items) {
    if (!items || !items.length) {
      return null;
    }
    var attachment = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].isAttachment() && items[i].isPDFAttachment()) {
        attachment = items[i];
        break;
      }
    }
    if (!attachment) {
      for (var j = 0; j < items.length; j++) {
        if (items[j].isAttachment()) {
          attachment = items[j];
          break;
        }
      }
    }

    var item = null;
    if (attachment) {
      if (attachment.parentID) {
        item = Zotero.Items.get(attachment.parentID) || null;
      }
    }
    else {
      for (var k = 0; k < items.length; k++) {
        if (!items[k].isAttachment() && !items[k].isNote()) {
          item = items[k];
          break;
        }
      }
    }
    if (!attachment && !item) {
      return null;
    }
    return { attachment: attachment, item: item };
  }

  async function extractPDFText(attachment, maxChars) {
    try {
      var cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
      if (cacheFile && cacheFile.exists && cacheFile.exists()) {
        // Only the beginning of the full-text cache is needed: ISBN, title and
        // publisher almost always appear on the first pages. Reading 4 MB for
        // every PDF made large batches slow.
        return await Zotero.File.getContentsAsync(cacheFile, null, maxChars || 16000);
      }
    }
    catch (e) {
      log("fulltext cache read failed: " + e);
    }
    return "";
  }

  async function findISBNInPDF(attachment) {
    var text = await extractPDFText(attachment);
    if (!text) {
      return "";
    }
    var isbns = C.extractISBNs(text);
    return isbns[0] || "";
  }

  async function buildSeed(target) {
    var seed = {
      isbn: "",
      title: "",
      authors: [],
      year: "",
      publisher: "",
      itemID: null,
      attachmentID: null,
      targetLabel: "未关联条目（匹配后新建图书）"
    };

    if (target && target.item) {
      var item = target.item;
      seed.itemID = item.id;
      seed.title = safeGetField(item, "title");
      seed.isbn = C.normalizeISBN(safeGetField(item, "ISBN"));
      seed.year = safeGetField(item, "date");
      seed.publisher = safeGetField(item, "publisher");
      seed.authors = item.getCreators()
        .filter(function (creator) { return creator.creatorType === "author"; })
        .map(function (creator) {
          return [creator.firstName, creator.lastName].filter(Boolean).join(" ");
        })
        .filter(Boolean);
      seed.targetLabel = (seed.title || "(无标题)") + " · " + Zotero.ItemTypes.getName(item.itemTypeID);
    }

    if (target && target.attachment) {
      seed.attachmentID = target.attachment.id;
      if (!seed.title) {
        seed.title = C.titleFromFilename(target.attachment.attachmentFilename || "");
      }
      if (!seed.isbn && target.attachment.isPDFAttachment()) {
        seed.isbn = await findISBNInPDF(target.attachment);
      }
      if (!seed.itemID) {
        seed.targetLabel = "PDF：" + (target.attachment.attachmentFilename || "");
      }
    }

    return seed;
  }

  function openSearch(seed) {
    var win = Zotero.getMainWindow();
    if (!win) {
      return;
    }
    var data = seed || {};
    data.debug = debug;
    return win.openDialog(
      DIALOG_URL,
      "duxiumeta-search-" + Date.now(),
      "chrome,centerscreen,resizable=yes,width=1060,height=740",
      data
    );
  }

  /**
   * Open a small browser window so the user can solve a Douban challenge.
   * The window shares Zotero's cookie jar with Zotero.HTTP, so a successful
   * verification also unblocks the next search request.
   * @returns {Promise<boolean>} true if the user clicked "验证完成，重试"
   */
  function openVerification(url) {
    return new Promise(function (resolve) {
      verifyState.url = url || "https://www.douban.com/";
      verifyState.resolve = resolve;

      var win = Zotero.getMainWindow().openDialog(
        "chrome://duxiumeta/content/verify.xhtml",
        "duxiumeta-verify-" + Date.now(),
        "chrome,centerscreen,resizable=yes,width=980,height=760"
      );
      if (!win) {
        verifyState.resolve = null;
        resolve(false);
        return;
      }
      // "unload" also fires while the dialog's initial about:blank document is
      // replaced, so use "close" to detect a user-initiated close.
      win.addEventListener("close", function () {
        if (verifyState.resolve === resolve) {
          verifyState.resolve = null;
          resolve(false);
        }
      }, { once: true });
    });
  }

  function getVerificationURL() {
    return verifyState.url;
  }

  function finishVerification(ok) {
    var resolve = verifyState.resolve;
    verifyState.resolve = null;
    if (resolve) {
      resolve(!!ok);
    }
  }

  async function searchFromSelection() {
    var target = resolveTarget(getSelectedItems());
    if (!target) {
      return;
    }
    var seed = await buildSeed(target);
    openSearch(seed);
  }

  async function searchFromClipboard() {
    var win = Zotero.getMainWindow();
    var text = "";
    try {
      text = await win.navigator.clipboard.readText();
    }
    catch (e) {
      notify("无法读取剪贴板", "请手动在搜索框中输入书名或 ISBN。");
      return;
    }
    text = C.cleanText(text).slice(0, 300);
    if (!text) {
      notify("剪贴板为空", "复制 ISBN 或书名后再试。");
      return;
    }
    var isbn = C.extractISBNs(text)[0] || "";
    openSearch({
      isbn: isbn,
      title: isbn ? "" : text,
      authors: [],
      year: "",
      publisher: "",
      itemID: null,
      attachmentID: null,
      targetLabel: "未关联条目（匹配后新建图书）"
    });
  }

  // ---------------------------------------------------------------------------
  // Applying metadata
  // ---------------------------------------------------------------------------

  function isFieldValidForItem(item, field) {
    try {
      var fieldID = Zotero.ItemFields.getID(field);
      if (!fieldID) {
        return false;
      }
      return Zotero.ItemFields.isValidForType(fieldID, item.itemTypeID);
    }
    catch (e) {
      return false;
    }
  }

  function buildCreators(result) {
    var creators = [];
    function add(names, creatorType) {
      (names || []).forEach(function (name) {
        var creator = C.toCreator(name);
        if (creator && creator.lastName) {
          creators.push({
            firstName: creator.firstName,
            lastName: creator.lastName,
            creatorType: creatorType
          });
        }
      });
    }
    add(result.authors, "author");
    add(result.translators, "translator");
    add(result.editors, "editor");
    return creators;
  }

  /**
   * Apply a search result to a target item (or create a new book item).
   * @param {Object} result
   * @param {Object} target {itemID, attachmentID}
   * @param {Object} [options] {overwrite}
   * @returns {Promise<{itemID: number, created: boolean}>}
   */
  async function applyResult(result, target, options) {
    options = options || {};
    var overwrite = !!options.overwrite;

    var item = target && target.itemID ? Zotero.Items.get(target.itemID) : null;
    var attachment = target && target.attachmentID ? Zotero.Items.get(target.attachmentID) : null;

    if (item && item.isAttachment()) {
      item = null;
    }

    var created = false;
    if (!item) {
      item = new Zotero.Item("book");
      if (attachment) {
        item.libraryID = attachment.libraryID;
      }
      await item.saveTx();
      created = true;

      if (attachment && !attachment.parentID) {
        attachment.parentItemID = item.id;
        await attachment.saveTx();
      }
    }

    var typeName = Zotero.ItemTypes.getName(item.itemTypeID);
    var fields = C.toBookFields(result);
    var applied = [];

    Object.keys(fields).forEach(function (field) {
      var value = fields[field];
      if (!value) {
        return;
      }
      if (!isFieldValidForItem(item, field)) {
        return;
      }
      var existing = "";
      try {
        existing = item.getField(field);
      }
      catch (e) {
        existing = "";
      }
      if (!overwrite && existing) {
        return;
      }
      try {
        item.setField(field, value);
        applied.push(field);
      }
      catch (e) {
        log("setField " + field + " failed: " + e);
      }
    });

    var creators = buildCreators(result);
    if (creators.length && (overwrite || item.getCreators().length === 0)) {
      try {
        item.setCreators(creators);
        applied.push("creators");
      }
      catch (e) {
        log("setCreators failed: " + e);
      }
    }

    await item.saveTx();

    if (typeName !== "book" && typeName !== "bookSection" && created === false) {
      log("applied book metadata to non-book item " + typeName + " (valid fields only)");
    }

    return { itemID: item.id, created: created, applied: applied };
  }

  // ---------------------------------------------------------------------------
  // Progress notifications
  // ---------------------------------------------------------------------------

  function notify(headline, message) {
    try {
      var progress = new Zotero.ProgressWindow({ closeOnClick: true });
      progress.changeHeadline("读秀元数据");
      progress.addDescription(headline);
      if (message) {
        progress.addDescription(message);
      }
      progress.show();
      progress.startCloseTimer(5000);
    }
    catch (e) {
      log("ProgressWindow failed: " + e);
    }
  }

  // ---------------------------------------------------------------------------
  // Auto matching on PDF import
  // ---------------------------------------------------------------------------

  function scheduleAutoImport(attachment) {
    pendingAuto.set(attachment.id, Date.now());
    if (autoTimer) {
      clearTimeout(autoTimer);
    }
    autoTimer = setTimeout(processAutoQueue, 8000);
  }

  async function processAutoQueue() {
    autoTimer = null;
    var ids = Array.from(pendingAuto.keys());
    pendingAuto.clear();
    for (var i = 0; i < ids.length; i++) {
      try {
        await autoMatchAttachment(ids[i]);
      }
      catch (e) {
        log("auto match failed for " + ids[i] + ": " + e);
      }
    }
  }

  async function autoMatchAttachment(attachmentID) {
    if (!getBool("autoOnImport", false)) {
      return;
    }
    var attachment = Zotero.Items.get(attachmentID);
    if (!attachment || !attachment.isAttachment() || !attachment.isPDFAttachment()) {
      return;
    }
    if (attachment.parentID) {
      return;
    }
    var isbn = "";
    for (var attempt = 0; attempt < 4 && !isbn; attempt++) {
      isbn = await findISBNInPDF(attachment);
      if (!isbn) {
        await Zotero.Promise.delay(4000);
      }
    }
    if (!isbn) {
      return;
    }
    var outcome = await searchAll({ text: "", hintIsbn: isbn }, {
      sources: getEnabledSources()
    });
    var top = outcome.results[0];
    if (!top || C.normalizeISBN(top.isbn) !== isbn) {
      return;
    }
    var minScore = parseFloat(getPref("autoMinScore", "0.92")) || 0.92;
    if (top.score < minScore) {
      return;
    }
    await enrichResult(top);
    var applied = await applyResult(top, { itemID: null, attachmentID: attachment.id }, {
      overwrite: false
    });
    notify("已自动补全元数据", (top.title || "") + " · ISBN " + C.formatISBN(isbn));
    log("auto-created parent item " + applied.itemID);
  }

  async function onNotify(event, type, ids) {
    if (type !== "item" || event !== "add" || !getBool("autoOnImport", false)) {
      return;
    }
    for (var i = 0; i < ids.length; i++) {
      var item = Zotero.Items.get(ids[i]);
      if (item && item.isAttachment() && item.isPDFAttachment()) {
        scheduleAutoImport(item);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Optional AI ranking (OpenAI-compatible chat completions)
  // ---------------------------------------------------------------------------

  function aiConfigured() {
    return getBool("ai.enabled", false)
      && !!String(getPref("ai.baseURL", "")).trim()
      && !!String(getPref("ai.model", "")).trim();
  }

  function parseAIJSON(content) {
    if (!content) {
      return null;
    }
    var text = String(content).trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(text.slice(start, end + 1));
    }
    catch (e) {
      return null;
    }
  }

  /**
   * Ask an OpenAI-compatible model to choose among candidate records.
   * Only bibliographic text and a short first-pages excerpt are sent.
   * @returns {Promise<{index: number, model: string}|null>}
   */
  async function aiPickCandidate(desc, candidates) {
    if (!aiConfigured() || !candidates || candidates.length < 2) {
      return null;
    }

    var base = String(getPref("ai.baseURL", "")).trim().replace(/\/+$/, "");
    var url = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
    var apiKey = String(getPref("ai.apiKey", "")).trim();
    var model = String(getPref("ai.model", "")).trim();

    var headers = { "Content-Type": "application/json" };
    if (apiKey) {
      headers.Authorization = "Bearer " + apiKey;
    }

    var payload = {
      filename: desc.filename,
      currentTitle: desc.title,
      detectedISBN: desc.isbn,
      candidates: candidates.map(function (candidate, index) {
        return {
          index: index,
          title: candidate.title,
          authors: (candidate.authors || []).slice(0, 3),
          publisher: candidate.publisher,
          date: candidate.date,
          isbn: candidate.isbn,
          source: candidate.source
        };
      })
    };

    // A short excerpt is enough to recognize the book and keeps token usage low.
    var snippet = String(desc.snippet || "").trim().slice(0, 2000);
    if (snippet) {
      payload.firstPages = snippet;
    }

    var body = {
      model: model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "你是图书元数据匹配助手。只根据文件名、ISBN/书名、PDF 前几页片段和候选书目选择最匹配的一条。"
            + "片段可能含页眉、目录或正文，忽略无关内容，不要臆造。"
            + "只返回 JSON，例如 {\"index\": 0}；没有合适的候选返回 {\"index\": -1}。不要输出解释。"
        },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ]
    };

    var xhr = await Zotero.HTTP.request("POST", url, {
      headers: headers,
      body: JSON.stringify(body),
      responseType: "text",
      timeout: 20000,
      successCodes: false,
      errorDelayMax: 10000
    });
    if (xhr.status && (xhr.status < 200 || xhr.status >= 300)) {
      throw new Error("AI 接口返回 HTTP " + xhr.status);
    }

    var json = JSON.parse(xhr.responseText || "{}");
    var content = json.choices && json.choices[0] && json.choices[0].message
      && json.choices[0].message.content;
    var parsed = parseAIJSON(content);
    if (parsed && typeof parsed.index === "number" && candidates[parsed.index]) {
      return { index: parsed.index, model: model };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Batch matching
  // ---------------------------------------------------------------------------

  function describeAttachment(attachment, parent) {
    var authors = [];
    var year = "";
    var publisher = "";
    var title = "";
    var isbn = "";

    if (parent) {
      title = safeGetField(parent, "title");
      isbn = C.normalizeISBN(safeGetField(parent, "ISBN"));
      year = safeGetField(parent, "date");
      publisher = safeGetField(parent, "publisher");
      authors = parent.getCreators()
        .filter(function (creator) { return Zotero.CreatorTypes.getName(creator.creatorTypeID) === "author"; })
        .map(function (creator) {
          return [creator.firstName, creator.lastName].filter(Boolean).join(" ");
        })
        .filter(Boolean);
    }

    return {
      attachmentID: attachment.id,
      itemID: parent ? parent.id : null,
      filename: attachment.attachmentFilename || "",
      title: title,
      isbn: isbn,
      authors: authors,
      year: year,
      publisher: publisher,
      itemType: parent ? Zotero.ItemTypes.getName(parent.itemTypeID) : "attachment"
    };
  }

  /**
   * List PDF attachments in a collection.
   * @param {Number} collectionID
   * @param {Boolean} recursive Include subcollections
   * @returns {Promise<Object[]>}
   */
  async function getCollectionPDFs(collectionID, recursive) {
    var collection = Zotero.Collections.get(collectionID);
    if (!collection) {
      throw new Error("找不到这个分类");
    }

    var itemIDs = recursive
      ? collection.getDescendents(false, "item").map(function (entry) { return entry.id; })
      : collection.getChildItems(true);
    var items = Zotero.Items.get(itemIDs);
    var descriptors = [];
    var seenParents = Object.create(null);
    var seenAttachments = Object.create(null);

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || item.deleted) {
        continue;
      }

      if (item.isAttachment()) {
        if (item.isPDFAttachment() && !seenAttachments[item.id]) {
          seenAttachments[item.id] = true;
          descriptors.push(describeAttachment(item, null));
        }
        continue;
      }

      if (item.isNote()) {
        continue;
      }
      if (seenParents[item.id]) {
        continue;
      }

      var attachments = item.getAttachments();
      for (var j = 0; j < attachments.length; j++) {
        var attachment = Zotero.Items.get(attachments[j]);
        if (attachment && attachment.isPDFAttachment() && !seenAttachments[attachment.id]) {
          seenAttachments[attachment.id] = true;
          seenParents[item.id] = true;
          descriptors.push(describeAttachment(attachment, item));
          break;
        }
      }
    }

    return descriptors;
  }

  async function getPDFInfo(attachmentID, snippetLength) {
    var attachment = Zotero.Items.get(attachmentID);
    if (!attachment || !attachment.isPDFAttachment()) {
      return { isbn: "", snippet: "" };
    }

    var text = await extractPDFText(attachment, 16000);
    if (!text) {
      // The PDF may still be in Zotero's indexing queue. Trigger it and give
      // the cache a few seconds to appear; don't block a batch for long.
      try {
        await Zotero.Fulltext.indexItems([attachment.id]);
      }
      catch (e) {
        log("fulltext trigger failed: " + e);
      }
      for (var i = 0; i < 4 && !text; i++) {
        await new Promise(function (resolve) { setTimeout(resolve, 800); });
        text = await extractPDFText(attachment, 16000);
      }
    }

    return {
      isbn: C.extractISBNs(text)[0] || "",
      snippet: String(text || "").slice(0, snippetLength || 0)
    };
  }

  async function getPDFISBN(attachmentID) {
    var info = await getPDFInfo(attachmentID, 0);
    return info.isbn;
  }

  function openBatch(data) {
    var win = Zotero.getMainWindow();
    if (!win) {
      return null;
    }
    return win.openDialog(
      "chrome://duxiumeta/content/batch.xhtml",
      "duxiumeta-batch-" + Date.now(),
      "chrome,centerscreen,resizable=yes,width=1120,height=780",
      data || {}
    );
  }

  function addCollectionMenu(win) {
    if (!win || !win.document || !win.ZoteroPane) {
      return;
    }
    var doc = win.document;
    var popup = doc.getElementById("zotero-collectionmenu");
    if (!popup || doc.getElementById(COLLECTION_MENU_ID)) {
      return;
    }

    var menu = doc.createXULElement("menu");
    menu.id = COLLECTION_MENU_ID;
    menu.setAttribute("label", "读秀元数据");
    menu.setAttribute("class", "menu-iconic");
    menu.setAttribute("image", ICON_URL);

    var submenu = doc.createXULElement("menupopup");
    menu.appendChild(submenu);

    var batchItem = createMenuItem(doc, "AI 批量匹配…", function () {
      var collection = win.ZoteroPane.getSelectedCollection();
      if (!collection) {
        return;
      }
      openBatch({ collectionID: collection.id, collectionName: collection.name });
    });
    submenu.appendChild(batchItem);

    menu.addEventListener("popupshowing", function () {
      var collection = win.ZoteroPane.getSelectedCollection();
      batchItem.disabled = !collection;
    });

    popup.appendChild(menu);
  }

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  function createMenuItem(doc, label, handler) {
    var menuitem = doc.createXULElement("menuitem");
    menuitem.setAttribute("label", label);
    menuitem.addEventListener("command", handler);
    return menuitem;
  }

  function updateMenuState(win) {
    var menu = win.document.getElementById(MENU_ID);
    if (!menu) {
      return;
    }
    var items = win.ZoteroPane ? win.ZoteroPane.getSelectedItems() : [];
    var target = resolveTarget(items);
    var first = menu.querySelector('[data-role="search"]');
    if (first) {
      first.disabled = !target;
    }
  }

  function addMenu(win) {
    if (!win || !win.document || !win.ZoteroPane) {
      return;
    }
    var doc = win.document;
    var popup = doc.getElementById("zotero-itemmenu");
    if (!popup || doc.getElementById(MENU_ID)) {
      return;
    }

    var menu = doc.createXULElement("menu");
    menu.id = MENU_ID;
    menu.setAttribute("label", "读秀元数据");
    menu.setAttribute("class", "menu-iconic");
    menu.setAttribute("image", ICON_URL);

    var submenu = doc.createXULElement("menupopup");
    menu.appendChild(submenu);

    var searchItem = createMenuItem(doc, "搜索并匹配元数据…", function () {
      searchFromSelection();
    });
    searchItem.dataset.role = "search";
    submenu.appendChild(searchItem);

    submenu.appendChild(createMenuItem(doc, "从剪贴板识别 ISBN 并搜索…", function () {
      searchFromClipboard();
    }));

    var separator = doc.createXULElement("menuseparator");
    submenu.appendChild(separator);

    submenu.appendChild(createMenuItem(doc, "读秀元数据设置…", function () {
      try {
        Zotero.Utilities.Internal.openPreferences(PANE_ID);
      }
      catch (e) {
        try {
          Zotero.Utilities.Internal.openPreferences();
        }
        catch (e2) {
          log("openPreferences failed: " + e2);
        }
      }
    }));

    menu.addEventListener("popupshowing", function () {
      updateMenuState(win);
    });
    popup.appendChild(menu);
    addCollectionMenu(win);
  }

  function removeMenu(win) {
    if (!win || !win.document) {
      return;
    }
    var menu = win.document.getElementById(MENU_ID);
    if (menu) {
      menu.remove();
    }
    var collectionMenu = win.document.getElementById(COLLECTION_MENU_ID);
    if (collectionMenu) {
      collectionMenu.remove();
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async function startup(params) {
    rootURI = params.rootURI || "";
    debug = getBool("debug", false);

    try {
      await Zotero.PreferencePanes.register({
        pluginID: PLUGIN_ID,
        id: PANE_ID,
        src: "chrome://duxiumeta/content/preferences.xhtml",
        label: "读秀元数据",
        image: ICON_URL,
        stylesheets: ["chrome://duxiumeta/content/style/preferences.css"],
        helpURL: "https://github.com/wzs2004/zotero-duxiu-meta#readme"
      });
    }
    catch (e) {
      Zotero.logError(e);
    }

    getMainWindows().forEach(addMenu);

    try {
      notifierID = Zotero.Notifier.registerObserver({ notify: onNotify }, ["item"], "duxiumeta");
    }
    catch (e) {
      log("notifier registration failed: " + e);
    }

    log("started");
  }

  function onMainWindowLoad(win) {
    addMenu(win);
  }

  function onMainWindowUnload(win) {
    removeMenu(win);
  }

  function shutdown() {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    pendingAuto.clear();

    if (notifierID) {
      try {
        Zotero.Notifier.unregisterObserver(notifierID);
      }
      catch (e) {}
      notifierID = null;
    }

    getMainWindows().forEach(removeMenu);
  }

  Zotero.DuxiuMeta = {
    id: PLUGIN_ID,
    startup: startup,
    shutdown: shutdown,
    onMainWindowLoad: onMainWindowLoad,
    onMainWindowUnload: onMainWindowUnload,
    searchFromSelection: searchFromSelection,
    searchFromClipboard: searchFromClipboard,
    openSearch: openSearch,
    openBatch: openBatch,
    aiPickCandidate: aiPickCandidate,
    getCollectionPDFs: getCollectionPDFs,
    getPDFISBN: getPDFISBN,
    getPDFInfo: getPDFInfo,
    openVerification: openVerification,
    getVerificationURL: getVerificationURL,
    finishVerification: finishVerification,
    searchAll: searchAll,
    enrichResult: enrichResult,
    applyResult: applyResult,
    getEnabledSources: getEnabledSources,
    getPref: getPref,
    core: C
  };
})();
