/* global module, URL, Intl */

/**
 * Duxiu Meta - pure helper library.
 *
 * This file deliberately has no dependency on Zotero so that the parsing and
 * matching logic can be unit-tested with plain Node.js (see test/unit.mjs).
 * It is loaded into the plugin sandbox before duxiumeta.js.
 */

var DuxiuMetaCore = (function () {
  "use strict";

  var SOURCE_NAMES = {
    duxiu: "读秀",
    douban: "豆瓣",
    google: "Google Books",
    openlibrary: "Open Library"
  };

  var SOURCE_ORDER = ["duxiu", "douban", "google", "openlibrary"];

  // ---------------------------------------------------------------------------
  // Text helpers
  // ---------------------------------------------------------------------------

  function cleanText(value) {
    return String(value == null ? "" : value)
      .replace(/\u00a0/g, " ")
      .replace(/[\t\r\n\f]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  var ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…",
    mdash: "—", ndash: "–", middot: "·", times: "×"
  };

  function decodeEntities(text) {
    return String(text == null ? "" : text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, body) {
      if (body[0] === "#") {
        var code = body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (!isNaN(code) && code > 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          }
          catch (e) {
            return m;
          }
        }
        return m;
      }
      var key = body.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
    });
  }

  function stripHTML(html) {
    if (!html) {
      return "";
    }
    return cleanText(
      decodeEntities(
        String(html)
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<br\s*\/?>/gi, " ")
          .replace(/<\/p>/gi, " ")
          .replace(/<[^>]+>/g, " ")
      )
    );
  }

  /**
   * Remove real HTML tags and tags that were escaped into text, e.g.
   * "<font color=Red>书名</font>" and "&lt;font&gt;书名&lt;/font&gt;".
   * Duxiu highlights search terms this way in its result markup.
   */
  function stripMarkup(value) {
    if (value == null) {
      return "";
    }
    var text = decodeEntities(String(value));
    text = text
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]*>/g, " ");
    return cleanText(decodeEntities(text));
  }

  function halfWidth(text) {
    return String(text == null ? "" : text).replace(/[\uff01-\uff5e]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    }).replace(/\u3000/g, " ");
  }

  /** Strip punctuation, brackets, spaces and case for fuzzy title matching. */
  function normalizeTitle(title) {
    var s = halfWidth(cleanText(title)).toLowerCase();
    s = s.replace(/[（(【\[][^）)】\]]{0,30}[）)】\]]/g, " ");
    s = s.replace(/[《》〈〉「」『』"'"'`]/g, " ");
    s = s.replace(/[\s\-_:：,，.。;；!！?？、\/\\|·~～@#$%^&*+=<>(){}\[\]]/g, "");
    return s;
  }

  function isCJK(text) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(text || ""));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function unique(list) {
    var seen = Object.create(null);
    var out = [];
    (list || []).forEach(function (item) {
      var value = cleanText(item);
      if (!value) {
        return;
      }
      var key = value.toLowerCase();
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      out.push(value);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // ISBN
  // ---------------------------------------------------------------------------

  function isValidISBN10(value) {
    if (!/^\d{9}[\dX]$/.test(value)) {
      return false;
    }
    var sum = 0;
    for (var i = 0; i < 10; i++) {
      var digit = value[i] === "X" ? 10 : parseInt(value[i], 10);
      sum += digit * (10 - i);
    }
    return sum % 11 === 0;
  }

  function isValidISBN13(value) {
    if (!/^\d{13}$/.test(value)) {
      return false;
    }
    var sum = 0;
    for (var i = 0; i < 13; i++) {
      sum += parseInt(value[i], 10) * (i % 2 ? 3 : 1);
    }
    return sum % 10 === 0;
  }

  function isbn10To13(value) {
    var core = "978" + value.slice(0, 9);
    var sum = 0;
    for (var i = 0; i < 12; i++) {
      sum += parseInt(core[i], 10) * (i % 2 ? 3 : 1);
    }
    return core + String((10 - (sum % 10)) % 10);
  }

  /**
   * Return a valid ISBN-13 (digits only) or "".
   * Also accepts a bare ISBN-10 and converts it.
   */
  function normalizeISBN(value) {
    var s = String(value == null ? "" : value).toUpperCase().replace(/[^0-9X]/g, "");
    if (s.length === 10 && isValidISBN10(s)) {
      return isbn10To13(s);
    }
    if (s.length === 13 && isValidISBN13(s)) {
      return s;
    }
    return "";
  }

  /** Find all valid ISBNs in an arbitrary block of text. */
  function extractISBNs(text) {
    var source = String(text == null ? "" : text).toUpperCase();
    var out = [];
    var seen = Object.create(null);
    var re = /(?:97[89][\d\s\-]{9,17}|\d[\d\s\-]{8,15}[\dX])/g;
    var match;
    while ((match = re.exec(source))) {
      var candidate = match[0].replace(/[^0-9X]/g, "");
      var isbn = normalizeISBN(candidate);
      if (isbn && !seen[isbn]) {
        seen[isbn] = true;
        out.push(isbn);
      }
    }
    return out;
  }

  function formatISBN(isbn) {
    // ISBN hyphenation depends on publisher ranges, so keep the canonical
    // digits-only form instead of guessing wrong hyphens.
    return normalizeISBN(isbn);
  }

  // ---------------------------------------------------------------------------
  // Dates, languages, names
  // ---------------------------------------------------------------------------

  function normalizeDate(value) {
    var s = halfWidth(cleanText(value));
    if (!s) {
      return "";
    }
    var match = s.match(/((?:1[5-9]|20)\d{2})(?:\s*[-—–./年]\s*(\d{1,2}))?(?:\s*[-—–./月]\s*(\d{1,2}))?/);
    if (!match) {
      return s.slice(0, 40);
    }
    var year = match[1];
    var month = match[2] ? parseInt(match[2], 10) : 0;
    var day = match[3] ? parseInt(match[3], 10) : 0;
    if (month < 1 || month > 12) {
      return year;
    }
    if (day < 1 || day > 31) {
      return year + "-" + (month < 10 ? "0" + month : month);
    }
    return year + "-" + (month < 10 ? "0" + month : month) + "-" + (day < 10 ? "0" + day : day);
  }

  function extractYear(value) {
    var match = String(value == null ? "" : value).match(/(1[5-9]\d{2}|20\d{2})/);
    return match ? match[1] : "";
  }

  var LANGUAGE_MAP = {
    zh: "zh-CN", "zh-cn": "zh-CN", "zh-hans": "zh-CN", chi: "zh-CN", zho: "zh-CN",
    "zh-tw": "zh-TW", "zh-hant": "zh-TW",
    en: "en-US", eng: "en-US", "en-us": "en-US", "en-gb": "en-GB",
    ja: "ja-JP", jpn: "ja-JP", ko: "ko-KR", kor: "ko-KR",
    fr: "fr-FR", fre: "fr-FR", de: "de-DE", ger: "de-DE", ru: "ru-RU",
    es: "es-ES", it: "it-IT"
  };

  function normalizeLanguage(value) {
    var s = cleanText(value).toLowerCase().replace(/_/g, "-");
    if (!s) {
      return "";
    }
    if (LANGUAGE_MAP[s]) {
      return LANGUAGE_MAP[s];
    }
    if (/^[a-z]{2}$/.test(s)) {
      return s;
    }
    return s.slice(0, 20);
  }

  /** Split an author string such as "张三 / 李四" or "A; B". */
  function splitAuthors(value) {
    if (Array.isArray(value)) {
      return unique(value.map(stripAuthorRole));
    }
    var text = cleanText(value);
    if (!text) {
      return [];
    }
    return unique(
      halfWidth(text)
        .split(/\s*(?:\/|;|；|、|&|\band\b)\s*/i)
        .map(stripAuthorRole)
        .filter(Boolean)
    );
  }

  function stripAuthorRole(name) {
    var s = cleanText(name);
    // Remove leading nationality markers such as "[美]" / "【英】"
    s = s.replace(/^[\[【（(]\s*[^\]]{1,8}[\]】）)]\s*/, "");
    // Remove trailing role words
    s = s.replace(/\s*(著|编著|主编|编|译|等|撰|校注|校|注|绘|摄影)\s*$/g, "");
    s = s.replace(/[（(]\s*(著|编著|主编|编|译|等)\s*[）)]\s*$/g, "");
    return cleanText(s);
  }

  /** Convert a display name to a Zotero creator object. */
  function toCreator(name) {
    var s = stripAuthorRole(name);
    if (!s) {
      return null;
    }
    if (s.indexOf(", ") !== -1 && !isCJK(s)) {
      var parts = s.split(/,\s*/);
      return { firstName: cleanText(parts.slice(1).join(", ")), lastName: cleanText(parts[0]) };
    }
    if (isCJK(s)) {
      return { firstName: "", lastName: s };
    }
    var words = s.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      return { firstName: "", lastName: words[0] };
    }
    return {
      firstName: words.slice(0, -1).join(" "),
      lastName: words[words.length - 1]
    };
  }

  // ---------------------------------------------------------------------------
  // Similarity / scoring
  // ---------------------------------------------------------------------------

  function bigrams(text) {
    var out = [];
    for (var i = 0; i < text.length - 1; i++) {
      out.push(text.slice(i, i + 2));
    }
    return out;
  }

  function diceCoefficient(a, b) {
    if (!a || !b) {
      return 0;
    }
    if (a === b) {
      return 1;
    }
    var left = bigrams(a);
    var right = bigrams(b);
    if (!left.length || !right.length) {
      return 0;
    }
    var counts = Object.create(null);
    left.forEach(function (gram) {
      counts[gram] = (counts[gram] || 0) + 1;
    });
    var overlap = 0;
    right.forEach(function (gram) {
      if (counts[gram]) {
        counts[gram]--;
        overlap++;
      }
    });
    return (2 * overlap) / (left.length + right.length);
  }

  function titleSimilarity(a, b) {
    var left = normalizeTitle(a);
    var right = normalizeTitle(b);
    if (!left || !right) {
      return 0;
    }
    if (left === right) {
      return 1;
    }
    var dice = diceCoefficient(left, right);
    if (left.indexOf(right) !== -1 || right.indexOf(left) !== -1) {
      dice = Math.max(dice, 0.85);
    }
    return dice;
  }

  function authorSimilarity(authorsA, authorsB) {
    if (!authorsA || !authorsB || !authorsA.length || !authorsB.length) {
      return 0;
    }
    var best = 0;
    authorsA.forEach(function (left) {
      authorsB.forEach(function (right) {
        var score = titleSimilarity(left, right);
        if (score > best) {
          best = score;
        }
      });
    });
    return best;
  }

  /**
   * Score a search result against the query, in [0, 1].
   * @param {Object} result
   * @param {Object} query {isbn, title, authors, year, publisher}
   */
  function scoreResult(result, query) {
    var q = query || {};
    var qIsbn = normalizeISBN(q.isbn);
    var rIsbn = normalizeISBN(result.isbn);

    if (qIsbn && rIsbn && qIsbn === rIsbn) {
      return 1;
    }

    var score = 0;
    var titleScore = titleSimilarity(result.title, q.title);
    if (q.title) {
      score += 0.6 * titleScore;
    }

    if (q.authors && q.authors.length) {
      score += 0.15 * authorSimilarity(q.authors, result.authors);
    }

    var qYear = extractYear(q.year);
    var rYear = extractYear(result.date);
    if (qYear && rYear) {
      var diff = Math.abs(parseInt(qYear, 10) - parseInt(rYear, 10));
      score += diff === 0 ? 0.12 : diff === 1 ? 0.06 : 0;
    }

    if (q.publisher && result.publisher) {
      score += 0.08 * titleSimilarity(q.publisher, result.publisher);
    }

    if (qIsbn && rIsbn && qIsbn !== rIsbn) {
      score *= 0.55;
    }
    else if (!qIsbn && rIsbn) {
      score += 0.05;
    }

    if (!q.title && !qIsbn) {
      return 0;
    }

    // Searching by ISBN alone: a source that doesn't expose ISBNs in its
    // search results (Douban) would otherwise score 0 even for the right book.
    // Give such results a neutral score; the detail page usually resolves it.
    if (qIsbn && !rIsbn && !q.title) {
      return 0.55;
    }

    return Math.round(clamp(score, 0, 0.99) * 100) / 100;
  }

  function scoreAndSort(results, query) {
    var list = (results || []).map(function (result) {
      result.score = typeof result.score === "number" && result.score >= 1
        ? 1
        : scoreResult(result, query);
      return result;
    });
    list.sort(function (a, b) {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
    return list;
  }

  function dedupeResults(results) {
    var seen = Object.create(null);
    var out = [];
    (results || []).forEach(function (result) {
      var key = normalizeISBN(result.isbn) || (normalizeTitle(result.title) + "|" + extractYear(result.date));
      if (!key || key === "|") {
        key = result.source + "|" + (result.url || "") + "|" + normalizeTitle(result.title);
      }
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      out.push(result);
    });
    return out;
  }

  function mergeResult(target, patch) {
    if (!patch) {
      return target;
    }
    var fields = [
      "title", "subtitle", "publisher", "place", "date", "edition", "series",
      "seriesNumber", "numPages", "isbn", "language", "abstractNote", "url", "cover"
    ];
    fields.forEach(function (field) {
      if (!target[field] && patch[field]) {
        target[field] = patch[field];
      }
    });
    ["authors", "translators", "editors"].forEach(function (field) {
      if ((!target[field] || !target[field].length) && patch[field] && patch[field].length) {
        target[field] = patch[field].slice();
      }
    });
    target.enriched = true;
    return target;
  }

  // ---------------------------------------------------------------------------
  // Result -> Zotero field helper
  // ---------------------------------------------------------------------------

  function buildTitle(result) {
    var title = stripMarkup(result.title);
    var subtitle = stripMarkup(result.subtitle);
    if (!subtitle) {
      return title;
    }
    if (normalizeTitle(title).indexOf(normalizeTitle(subtitle)) !== -1) {
      return title;
    }
    return title ? title + "：" + subtitle : subtitle;
  }

  function toBookFields(result) {
    var fields = {};
    fields.title = buildTitle(result);
    if (result.publisher) {
      fields.publisher = stripMarkup(result.publisher);
    }
    if (result.place) {
      fields.place = stripMarkup(result.place);
    }
    if (result.date) {
      fields.date = normalizeDate(result.date);
    }
    if (result.edition) {
      fields.edition = stripMarkup(result.edition);
    }
    if (result.series) {
      fields.series = stripMarkup(result.series);
    }
    if (result.seriesNumber) {
      fields.seriesNumber = stripMarkup(result.seriesNumber);
    }
    if (result.numPages) {
      var pages = parseInt(String(result.numPages).replace(/[^\d]/g, ""), 10);
      if (pages > 0 && pages < 100000) {
        fields.numPages = String(pages);
      }
    }
    if (result.isbn) {
      fields.ISBN = formatISBN(result.isbn);
    }
    if (result.language) {
      fields.language = normalizeLanguage(result.language);
    }
    if (result.abstractNote) {
      var abstract = stripHTML(result.abstractNote);
      fields.abstractNote = abstract.length > 4000 ? abstract.slice(0, 4000) + "…" : abstract;
    }
    if (result.url) {
      fields.url = result.url;
    }
    fields.libraryCatalog = SOURCE_NAMES[result.source] || result.source || "";
    return fields;
  }

  // ---------------------------------------------------------------------------
  // HTML parsing helpers
  // ---------------------------------------------------------------------------

  function textOf(node) {
    return node ? cleanText(node.textContent) : "";
  }

  function firstText(root, selector) {
    if (!root) {
      return "";
    }
    return textOf(root.querySelector(selector));
  }

  function absolutize(href, base) {
    try {
      return new URL(href, base).href;
    }
    catch (e) {
      return "";
    }
  }

  function resolveDoubanSubject(href) {
    try {
      var url = new URL(href, "https://www.douban.com/");
      if (url.hostname === "www.douban.com" && url.pathname === "/link2/") {
        url = new URL(url.searchParams.get("url") || "", "https://www.douban.com/");
      }
      if (url.hostname !== "book.douban.com" || !/^\/subject\/\d+\/?$/.test(url.pathname)) {
        return "";
      }
      return "https://book.douban.com" + url.pathname.replace(/\/?$/, "/");
    }
    catch (e) {
      return "";
    }
  }

  // ---------------------------------------------------------------------------
  // Douban
  // ---------------------------------------------------------------------------

  function parseDoubanSearch(doc) {
    var results = [];
    var nodes = doc.querySelectorAll(".result");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var link = node.querySelector(".title h3 a") || node.querySelector(".title a");
      if (!link) {
        continue;
      }
      var url = resolveDoubanSubject(link.getAttribute("href") || link.href);
      if (!url) {
        continue;
      }
      var title = textOf(link).replace(/\s*[（(]豆瓣[）)]\s*$/, "");
      if (!title) {
        continue;
      }
      var cast = firstText(node, ".subject-cast");
      var parts = cast.split(/\s*\/\s*/).filter(Boolean);
      var authors = [];
      var translators = [];
      var publisher = "";
      var date = "";

      // Douban search results use "作者 / 译者 / 出版社 / 年份".
      // When there is no translator the translator slot is omitted.
      if (parts.length >= 4) {
        authors = splitAuthors(parts[0]);
        if (/出版社|书局|出版公司|出版集团|集团/.test(parts[1])) {
          publisher = parts[1];
          date = normalizeDate(parts[2]);
        }
        else {
          translators = splitAuthors(parts[1]);
          publisher = parts[2];
          date = normalizeDate(parts[3]);
        }
      }
      else if (parts.length === 3) {
        authors = splitAuthors(parts[0]);
        publisher = parts[1];
        date = normalizeDate(parts[2]);
      }
      else if (parts.length === 2) {
        authors = splitAuthors(parts[0]);
        publisher = parts[1];
      }
      else if (parts.length === 1) {
        authors = splitAuthors(parts[0]);
      }

      var rating = firstText(node, ".rating_nums") || firstText(node, ".rating-info .rating_nums");
      results.push({
        source: "douban",
        url: url,
        title: title,
        authors: authors,
        translators: translators,
        publisher: publisher,
        date: date,
        extra: rating ? "豆瓣评分 " + rating : ""
      });
    }
    return results;
  }

  var DOUBAN_LABELS = {
    "作者": "authors",
    "译者": "translators",
    "出版社": "publisher",
    "出版年": "date",
    "出版时间": "date",
    "页数": "numPages",
    "丛书": "series",
    "ISBN": "isbn",
    "副标题": "subtitle",
    "原作名": "originalTitle",
    "装帧": "binding",
    "定价": "price",
    "出品方": "producer"
  };

  function parseDoubanDetail(doc) {
    var data = { source: "douban", url: doc.location ? doc.location.href : "" };
    data.title = firstText(doc, 'h1 span[property="v:itemreviewed"]') || firstText(doc, "h1");
    data.title = data.title.replace(/\s*[（(]豆瓣[）)]\s*$/, "");

    var info = doc.querySelector("#info");
    if (info) {
      var lines = info.innerHTML.split(/<br\s*\/?>/i);
      lines.forEach(function (line) {
        var plain = stripHTML(line);
        var match = plain.match(/^([^:：]{1,10})[:：]\s*(.+)$/);
        if (!match) {
          return;
        }
        var label = cleanText(match[1]).replace(/\s+/g, "");
        var value = cleanText(match[2]);
        var key = DOUBAN_LABELS[label];
        if (!key || data[key]) {
          return;
        }
        if (key === "authors" || key === "translators") {
          data[key] = splitAuthors(value);
        }
        else if (key === "numPages") {
          var pages = parseInt(value.replace(/[^\d]/g, ""), 10);
          if (pages > 0) {
            data.numPages = pages;
          }
        }
        else if (key === "isbn") {
          data.isbn = normalizeISBN(extractISBNs(value)[0] || value);
        }
        else if (key === "date") {
          data.date = normalizeDate(value);
        }
        else {
          data[key] = value;
        }
      });
    }

    var intro = doc.querySelector("#intro .intro") || doc.querySelector("#link-report .intro");
    if (intro) {
      data.abstractNote = textOf(intro);
    }
    var cover = doc.querySelector("#mainpic img");
    if (cover) {
      data.cover = cover.getAttribute("src") || "";
    }
    var rating = doc.querySelector(".rating_num");
    if (rating) {
      data.extra = "豆瓣评分 " + textOf(rating);
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Duxiu (读秀)
  // ---------------------------------------------------------------------------

  var DUXIU_LABELS = {
    "书名": "title",
    "题名": "title",
    "作者": "authors",
    "责任者": "authors",
    "著者": "authors",
    "出版社": "publisher",
    "出版地": "place",
    "出版发行": "publication",
    "出版日期": "date",
    "出版时间": "date",
    "出版年": "date",
    "ISBN": "isbn",
    "isbn": "isbn",
    "页数": "numPages",
    "页码": "numPages",
    "定价": "price",
    "主题": "subject",
    "丛书名": "series",
    "丛书": "series",
    "中图法分类号": "classification",
    "版次": "edition",
    "内容提要": "abstractNote",
    "简介": "abstractNote",
    "摘要": "abstractNote"
  };

  function labelKey(label) {
    var cleaned = cleanText(label).replace(/[:：]\s*$/, "").replace(/\s+/g, "");
    if (DUXIU_LABELS[cleaned]) {
      return DUXIU_LABELS[cleaned];
    }
    var lower = cleaned.toLowerCase();
    if (DUXIU_LABELS[lower]) {
      return DUXIU_LABELS[lower];
    }
    return "";
  }

  /**
   * Duxiu prints responsibility statements as
   * "（美）ERIC MATTHES著；袁国忠译".
   */
  function parseResponsibility(value) {
    var authors = [];
    var translators = [];
    String(value == null ? "" : value).split(/[;；]/).forEach(function (segment) {
      var s = cleanText(segment);
      if (!s) {
        return;
      }
      if (/译\s*$/.test(s)) {
        translators.push(s.replace(/译\s*$/, ""));
        return;
      }
      if (/(编著|主编|编)\s*$/.test(s)) {
        authors.push(s.replace(/(编著|主编|编)\s*$/, ""));
        return;
      }
      authors.push(s.replace(/著\s*$/, ""));
    });
    return {
      authors: unique(authors.map(stripAuthorRole)),
      translators: unique(translators.map(stripAuthorRole))
    };
  }

  /**
   * "北京：人民邮电出版社 , 2016.07" -> place / publisher / date
   */
  function parsePublication(value, data) {
    var parts = String(value == null ? "" : value).split(/\s*[,，]\s*/);
    var left = parts[0] || "";
    var match = left.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (match) {
      data.place = cleanText(match[1]);
      data.publisher = cleanText(match[2]);
    }
    else {
      data.publisher = cleanText(left);
    }
    if (parts[1]) {
      data.date = normalizeDate(parts[1]);
    }
    if (!data.date) {
      var year = left.match(/((?:19|20)\d{2}(?:[.\-/]\d{1,2})?)/);
      if (year) {
        data.date = normalizeDate(year[1]);
      }
    }
  }

  function cleanDuxiuTitle(value) {
    var text = stripMarkup(value);
    var bracketed = text.match(/《([^》]{1,150})》/);
    if (bracketed) {
      return cleanText(bracketed[1]);
    }
    text = text.replace(/^(?:导出|分享|点击复制|QQ空间|QQ好友|微信扫一扫|收藏|复制链接|举报)\s*/g, "");
    return cleanText(text);
  }

  /**
   * Parse one "label: value" line found in a <dd>/<dt> or table cell.
   * Returns true if the line was recognized.
   */
  function parseDuxiuLabeledText(text, data) {
    var match = cleanText(text).match(/^([^:：]{1,10})\s*[:：]\s*([\s\S]*)$/);
    if (!match) {
      return false;
    }
    var label = match[1].replace(/\s+/g, "");
    var value = cleanText(match[2]);
    if (!value) {
      return false;
    }
    var key = labelKey(label);
    if (!key) {
      return false;
    }
    if (key === "authors") {
      var responsibility = parseResponsibility(value);
      if (responsibility.authors.length) {
        data.authors = responsibility.authors;
      }
      if (responsibility.translators.length) {
        data.translators = responsibility.translators;
      }
      return true;
    }
    if (key === "publication") {
      parsePublication(value, data);
      return true;
    }
    if (key === "date") {
      data.date = normalizeDate(value);
      var pagesInline = value.match(/页数\s*[:：]?\s*(\d+)/);
      if (pagesInline) {
        data.numPages = parseInt(pagesInline[1], 10);
      }
      return true;
    }
    if (key === "numPages") {
      var pages = parseInt(value.replace(/[^\d]/g, ""), 10);
      if (pages > 0) {
        data.numPages = pages;
      }
      return true;
    }
    if (key === "isbn") {
      data.isbn = normalizeISBN(extractISBNs(value)[0] || value);
      return true;
    }
    if (key === "title") {
      if (!data.title && !/^(包含|等于|书名|题名)$/.test(value)) {
        data.title = cleanDuxiuTitle(value);
      }
      return true;
    }
    if (!data[key]) {
      data[key] = value;
    }
    return true;
  }

  function collectDuxiuData(root, data) {
    var dds = root.querySelectorAll("dd");
    for (var i = 0; i < dds.length; i++) {
      parseDuxiuLabeledText(dds[i].textContent, data);
    }

    var dts = root.querySelectorAll("dt");
    for (var j = 0; j < dts.length; j++) {
      var dt = dts[j];
      var label = cleanText(dt.textContent);
      var dd = dt.nextElementSibling;
      if (dd) {
        parseDuxiuLabeledText(label + " " + cleanText(dd.textContent), data);
      }
    }

    var rows = root.querySelectorAll("tr");
    for (var k = 0; k < rows.length; k++) {
      var cells = rows[k].children;
      if (cells && cells.length >= 2) {
        parseDuxiuLabeledText(cleanText(cells[0].textContent) + "：" + cleanText(cells[1].textContent), data);
      }
    }

    // Meta tags used by some detail layouts
    var metas = root.querySelectorAll("meta");
    for (var m = 0; m < metas.length; m++) {
      var name = (metas[m].getAttribute("name") || metas[m].getAttribute("property") || "").toLowerCase();
      var content = metas[m].getAttribute("content") || "";
      if (!content) {
        continue;
      }
      if (name === "description" && !data.abstractNote) {
        data.abstractNote = content;
      }
      else if (/isbn/.test(name) && !data.isbn) {
        data.isbn = normalizeISBN(extractISBNs(content)[0] || content);
      }
    }
  }

  function guessDuxiuAuthors(raw) {
    var text = cleanText(raw);
    var patterns = [
      /(?:作\s*者|责任者|著者|编\s*者)\s*[:：]\s*([^|/;；]{2,60})/,
      /([^\s|/;；,，]{2,20})\s*(?:著|编著|主编|编)\s*(?:\/|;|；|$)/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = text.match(patterns[i]);
      if (match) {
        return splitAuthors(match[1]);
      }
    }
    return [];
  }

  function closestInfoBlock(anchor) {
    var node = anchor;
    var best = anchor.parentElement || anchor;
    for (var depth = 0; depth < 6 && node; depth++) {
      node = node.parentElement;
      if (!node) {
        break;
      }
      var length = cleanText(node.textContent).length;
      if (length > 1500) {
        break;
      }
      if (length >= 10) {
        best = node;
        if (length > 60 && /(出版社|出版日期|ISBN|作者|定价)/.test(node.textContent)) {
          break;
        }
      }
    }
    return best;
  }

  function parseDuxiuSearch(doc, linkSelector) {
    var results = [];
    var seen = Object.create(null);

    // Modern search page: each hit is an <li> with hidden inputs for the title
    // and detail URL, plus a <dl> of <dd> fields.
    var titleInputs = doc.querySelectorAll('input[name$=".title"]');
    for (var i = 0; i < titleInputs.length; i++) {
      var input = titleInputs[i];
      var title = cleanText(input.value || input.getAttribute("value") || "");
      if (!title) {
        continue;
      }
      var block = input.closest ? input.closest("li") : input.parentElement;
      if (!block) {
        continue;
      }
      var urlInput = block.querySelector('input[name$=".url"]');
      var rawURL = urlInput ? (urlInput.value || urlInput.getAttribute("value") || "") : "";
      var url = absolutize(String(rawURL).trim(), "https://book.duxiu.com/");
      if (!url || seen[url]) {
        continue;
      }
      seen[url] = true;

      var data = {
        source: "duxiu",
        url: url,
        title: cleanDuxiuTitle(title),
        authors: [],
        translators: [],
        publisher: "",
        place: "",
        date: "",
        isbn: "",
        numPages: null,
        series: "",
        abstractNote: ""
      };
      collectDuxiuData(block, data);
      results.push(data);
    }

    if (results.length) {
      return results;
    }

    // Older search page: plain links to bookDetail.jsp
    var selector = linkSelector || 'a[href*="bookDetail.jsp"]';
    var anchors;
    try {
      anchors = doc.querySelectorAll(selector);
    }
    catch (e) {
      anchors = doc.querySelectorAll('a[href*="bookDetail.jsp"]');
    }
    for (var a = 0; a < anchors.length; a++) {
      var anchor = anchors[a];
      var href = anchor.getAttribute("href") || "";
      var detailURL = absolutize(href, "https://book.duxiu.com/");
      if (!detailURL || seen[detailURL]) {
        continue;
      }
      seen[detailURL] = true;

      var infoBlock = closestInfoBlock(anchor);
      var blockText = infoBlock ? cleanText(infoBlock.textContent) : "";
      var fallbackTitle = cleanDuxiuTitle(anchor.textContent) || cleanDuxiuTitle(blockText);
      var yearMatch = blockText.match(/((?:19|20)\d{2})\s*年?/);
      var publisherMatch = blockText.match(/([^\s|/;；]{2,30}出版社)/);

      results.push({
        source: "duxiu",
        url: detailURL,
        title: fallbackTitle,
        authors: guessDuxiuAuthors(blockText),
        publisher: publisherMatch ? publisherMatch[1] : "",
        date: yearMatch ? normalizeDate(yearMatch[1]) : "",
        isbn: extractISBNs(blockText)[0] || ""
      });
    }
    return results;
  }

  function parseDuxiuDetail(doc, url) {
    var data = {
      source: "duxiu",
      url: url || "",
      authors: [],
      translators: []
    };

    // Prefer <title>: Duxiu detail pages contain a search form whose "书名"
    // field would otherwise win with values like "包含 等于".
    var docTitle = cleanText(String(doc.title || "")).replace(/[_\-|]\s*(图书搜索|读秀|超星).*$/, "");
    if (docTitle && !/^(读秀|超星|图书搜索|读秀学术搜索)$/.test(docTitle)) {
      data.title = docTitle;
    }

    var heading = doc.querySelector("h1") || doc.querySelector(".bookname") || doc.querySelector(".title");
    if (heading && !data.title) {
      data.title = cleanText(heading.textContent);
    }

    collectDuxiuData(doc, data);

    if (!data.title) {
      data.title = cleanText(String(doc.title || "").replace(/[_\-|]\s*(图书搜索|读秀|超星).*$/, ""));
    }
    if (!data.abstractNote) {
      var desc = doc.querySelector("#content, .bookSummary, .summary, .intro");
      if (desc) {
        data.abstractNote = textOf(desc);
      }
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Google Books
  // ---------------------------------------------------------------------------

  function pickIndustryISBN(identifiers) {
    var list = identifiers || [];
    var isbn13 = list.filter(function (item) {
      return item.type === "ISBN_13";
    })[0];
    var isbn10 = list.filter(function (item) {
      return item.type === "ISBN_10";
    })[0];
    return normalizeISBN((isbn13 && isbn13.identifier) || (isbn10 && isbn10.identifier) || "");
  }

  function parseGoogleBooks(json) {
    var items = (json && json.items) || [];
    return items.map(function (item) {
      var info = item.volumeInfo || {};
      return {
        source: "google",
        url: info.infoLink || ("https://books.google.com/books?id=" + item.id),
        title: cleanText(info.title),
        subtitle: cleanText(info.subtitle),
        authors: unique(info.authors || []),
        publisher: cleanText(info.publisher),
        date: normalizeDate(info.publishedDate),
        numPages: info.pageCount || null,
        language: normalizeLanguage(info.language),
        isbn: pickIndustryISBN(info.industryIdentifiers),
        abstractNote: stripHTML(info.description || ""),
        cover: (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || ""
      };
    }).filter(function (item) {
      return !!item.title;
    });
  }

  // ---------------------------------------------------------------------------
  // Open Library
  // ---------------------------------------------------------------------------

  function parseOpenLibrary(json) {
    var docs = (json && json.docs) || [];
    return docs.map(function (doc) {
      var isbnList = (doc.isbn || []).map(normalizeISBN).filter(Boolean);
      var isbn13 = isbnList.filter(function (value) {
        return value.slice(0, 3) === "978" || value.slice(0, 3) === "979";
      })[0];
      var languages = doc.language || [];
      return {
        source: "openlibrary",
        url: "https://openlibrary.org" + (doc.key || ""),
        title: cleanText(doc.title),
        subtitle: cleanText(doc.subtitle),
        authors: unique(doc.author_name || []),
        publisher: unique(doc.publisher || [])[0] || "",
        date: normalizeDate(String(doc.first_publish_year || "")),
        numPages: doc.number_of_pages_median || null,
        language: normalizeLanguage(languages[0] || ""),
        isbn: isbn13 || isbnList[0] || "",
        abstractNote: "",
        cover: doc.cover_i ? ("https://covers.openlibrary.org/b/id/" + doc.cover_i + "-M.jpg") : ""
      };
    }).filter(function (item) {
      return !!item.title;
    });
  }

  // ---------------------------------------------------------------------------
  // Misc
  // ---------------------------------------------------------------------------

  function looksLikeISBN(text) {
    var value = String(text || "").replace(/[\s\-]/g, "");
    return normalizeISBN(value) !== "";
  }

  function titleFromFilename(filename) {
    var name = String(filename || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
    name = name.replace(/[（(]\s*\d+\s*[）)]\s*$/, "");
    name = name.replace(/[_]+/g, " ").replace(/\s{2,}/g, " ").trim();
    return name;
  }

  function sanitizeFilename(name) {
    return String(name || "")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 120);
  }

  return {
    SOURCE_NAMES: SOURCE_NAMES,
    SOURCE_ORDER: SOURCE_ORDER,
    cleanText: cleanText,
    stripHTML: stripHTML,
    stripMarkup: stripMarkup,
    decodeEntities: decodeEntities,
    halfWidth: halfWidth,
    normalizeTitle: normalizeTitle,
    isCJK: isCJK,
    normalizeISBN: normalizeISBN,
    extractISBNs: extractISBNs,
    formatISBN: formatISBN,
    normalizeDate: normalizeDate,
    extractYear: extractYear,
    normalizeLanguage: normalizeLanguage,
    splitAuthors: splitAuthors,
    toCreator: toCreator,
    titleSimilarity: titleSimilarity,
    scoreResult: scoreResult,
    scoreAndSort: scoreAndSort,
    dedupeResults: dedupeResults,
    mergeResult: mergeResult,
    toBookFields: toBookFields,
    resolveDoubanSubject: resolveDoubanSubject,
    parseDoubanSearch: parseDoubanSearch,
    parseDoubanDetail: parseDoubanDetail,
    parseDuxiuSearch: parseDuxiuSearch,
    parseDuxiuDetail: parseDuxiuDetail,
    parseGoogleBooks: parseGoogleBooks,
    parseOpenLibrary: parseOpenLibrary,
    looksLikeISBN: looksLikeISBN,
    titleFromFilename: titleFromFilename,
    sanitizeFilename: sanitizeFilename
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = DuxiuMetaCore;
}
