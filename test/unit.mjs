import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../chrome/content/scripts/core.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  }
  catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error.message}`);
  }
}

console.log("ISBN");

test("validates ISBN-10 and converts to ISBN-13", () => {
  assert.equal(C.normalizeISBN("0-306-40615-2"), "9780306406157");
});

test("normalizes hyphenated ISBN-13", () => {
  assert.equal(C.normalizeISBN("978-7-115-42802-8"), "9787115428028");
});

test("rejects bad checksum", () => {
  assert.equal(C.normalizeISBN("9787115428029"), "");
});

test("extracts ISBN from noisy text", () => {
  assert.deepEqual(
    C.extractISBNs("定价：89元 ISBN 978-7-115-42802-8 开本：16开"),
    ["9787115428028"]
  );
});

test("extracts ISBN-10 and converts", () => {
  assert.deepEqual(C.extractISBNs("ISBN: 0-306-40615-2"), ["9780306406157"]);
});

test("formatISBN keeps canonical digits", () => {
  assert.equal(C.formatISBN("978-7-115-42802-8"), "9787115428028");
});

console.log("Text / dates");

test("normalizeDate handles Chinese dates", () => {
  assert.equal(C.normalizeDate("2019年1月"), "2019-01");
  assert.equal(C.normalizeDate("2020-03-15"), "2020-03-15");
  assert.equal(C.normalizeDate("2018"), "2018");
});

test("extractYear", () => {
  assert.equal(C.extractYear("2019-01"), "2019");
  assert.equal(C.extractYear("无日期"), "");
});

test("normalizeTitle removes punctuation and brackets", () => {
  assert.equal(C.normalizeTitle("《Python 编程：从入门到实践（第2版）》"), "python编程从入门到实践");
});

test("splitAuthors handles Chinese separators", () => {
  assert.deepEqual(C.splitAuthors("张三 / 李四、王五"), ["张三", "李四", "王五"]);
});

test("stripAuthorRole removes nationality and role", () => {
  assert.deepEqual(C.splitAuthors("[美] 埃里克·马瑟斯 著"), ["埃里克·马瑟斯"]);
});

test("toCreator keeps CJK name intact", () => {
  assert.deepEqual(C.toCreator("张三"), { firstName: "", lastName: "张三" });
});

test("toCreator splits Western names", () => {
  assert.deepEqual(C.toCreator("Eric Matthes"), { firstName: "Eric", lastName: "Matthes" });
});

test("toCreator handles 'Last, First'", () => {
  assert.deepEqual(C.toCreator("Matthes, Eric"), { firstName: "Eric", lastName: "Matthes" });
});

test("titleFromFilename", () => {
  assert.equal(C.titleFromFilename("深入理解计算机系统_第3版.pdf"), "深入理解计算机系统 第3版");
});

console.log("Similarity / scoring");

test("identical titles score 1", () => {
  assert.equal(C.titleSimilarity("Python编程：从入门到实践", "Python编程 从入门到实践"), 1);
});

test("partial titles score high", () => {
  assert.ok(C.titleSimilarity("Python编程从入门到实践", "Python编程从入门到实践 第2版") > 0.8);
});

test("unrelated titles score low", () => {
  assert.ok(C.titleSimilarity("Python编程", "口腔颌面外科学") < 0.2);
});

test("exact ISBN always scores 1", () => {
  const score = C.scoreResult(
    { title: "完全不同的书名", isbn: "9787115428028" },
    { isbn: "978-7-115-42802-8", title: "Python编程" }
  );
  assert.equal(score, 1);
});

test("ISBN-only query gives ISBN-less results a neutral baseline", () => {
  assert.equal(
    C.scoreResult({ title: "Python编程", isbn: "" }, { isbn: "9787115428028" }),
    0.55
  );
});

test("mismatched ISBN is penalized", () => {
  const matching = C.scoreResult(
    { title: "Python编程", isbn: "9787115428028", authors: ["Eric Matthes"], date: "2016" },
    { isbn: "9787115428028", title: "Python编程", authors: ["Eric Matthes"], year: "2016" }
  );
  const mismatching = C.scoreResult(
    { title: "Python编程", isbn: "9780306406157", authors: ["Eric Matthes"], date: "2016" },
    { isbn: "9787115428028", title: "Python编程", authors: ["Eric Matthes"], year: "2016" }
  );
  assert.ok(matching > mismatching);
});

test("dedupeResults keeps one record per ISBN", () => {
  const results = C.dedupeResults([
    { source: "douban", title: "A", isbn: "9787115428028" },
    { source: "google", title: "A", isbn: "9787115428028" }
  ]);
  assert.equal(results.length, 1);
});

test("mergeResult fills only empty fields", () => {
  const target = { title: "A", isbn: "9787115428028", authors: ["张三"] };
  C.mergeResult(target, { title: "B", publisher: "人民邮电出版社", authors: ["李四"] });
  assert.equal(target.title, "A");
  assert.equal(target.publisher, "人民邮电出版社");
  assert.deepEqual(target.authors, ["张三"]);
});

console.log("Source parsers (JSON)");

test("parseGoogleBooks", () => {
  const results = C.parseGoogleBooks({
    items: [
      {
        id: "abc",
        volumeInfo: {
          title: "Python Crash Course",
          subtitle: "A Hands-On Project-Based Introduction",
          authors: ["Eric Matthes"],
          publisher: "No Starch Press",
          publishedDate: "2019-05",
          pageCount: 544,
          language: "en",
          industryIdentifiers: [
            { type: "ISBN_10", identifier: "1593279280" },
            { type: "ISBN_13", identifier: "9781593279288" }
          ],
          description: "<p>A book.</p>",
          infoLink: "https://books.google.com/books?id=abc"
        }
      }
    ]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Python Crash Course");
  assert.equal(results[0].isbn, "9781593279288");
  assert.equal(results[0].numPages, 544);
  assert.equal(results[0].abstractNote, "A book.");
});

test("parseOpenLibrary", () => {
  const results = C.parseOpenLibrary({
    docs: [
      {
        key: "/works/OL123W",
        title: "Structure and Interpretation of Computer Programs",
        author_name: ["Harold Abelson", "Gerald Jay Sussman"],
        first_publish_year: 1985,
        publisher: ["MIT Press"],
        isbn: ["0262510871", "9780262510875"],
        number_of_pages_median: 657,
        language: ["eng"],
        cover_i: 123
      }
    ]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].isbn, "9780262510875");
  assert.equal(results[0].date, "1985");
  assert.equal(results[0].language, "en-US");
  assert.equal(results[0].publisher, "MIT Press");
});

console.log("Misc");

test("looksLikeISBN", () => {
  assert.equal(C.looksLikeISBN("978-7-115-42802-8"), true);
  assert.equal(C.looksLikeISBN("Python编程"), false);
});

test("toBookFields builds a display title and valid fields", () => {
  const fields = C.toBookFields({
    source: "douban",
    title: "Python编程",
    subtitle: "从入门到实践",
    authors: ["Eric Matthes"],
    publisher: "人民邮电出版社",
    date: "2020-10",
    isbn: "9787115546081",
    language: "zh",
    abstractNote: "<b>简介</b>",
    url: "https://book.douban.com/subject/1/"
  });
  assert.equal(fields.title, "Python编程：从入门到实践");
  assert.equal(fields.ISBN, "9787115546081");
  assert.equal(fields.language, "zh-CN");
  assert.equal(fields.abstractNote, "简介");
  assert.equal(fields.libraryCatalog, "豆瓣");
});

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  process.exit(1);
}
