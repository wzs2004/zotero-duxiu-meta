/* global window, document, Services, Components */

(function () {
  "use strict";

  function getZotero() {
    try {
      if (window.opener && window.opener.Zotero) {
        return window.opener.Zotero;
      }
    }
    catch (e) {}

    try {
      var enumerator = Services.wm.getEnumerator("navigator:browser");
      while (enumerator.hasMoreElements()) {
        var win = enumerator.getNext();
        if (win.Zotero) {
          return win.Zotero;
        }
      }
    }
    catch (e) {}

    try {
      return Components.classes["@zotero.org/Zotero;1"]
        .getService(Components.interfaces.nsISupports).wrappedJSObject;
    }
    catch (e) {
      return null;
    }
  }

  var Zotero = getZotero();
  var api = Zotero && Zotero.DuxiuMeta;
  var browser = document.getElementById("duxiumeta-verify-browser");
  var url = (api && api.getVerificationURL && api.getVerificationURL()) || "https://www.douban.com/";

  function finish(ok) {
    try {
      if (api && api.finishVerification) {
        api.finishVerification(ok);
      }
    }
    catch (e) {}
    window.close();
  }

  document.getElementById("duxiumeta-verify-done").addEventListener("command", function () {
    finish(true);
  });
  document.getElementById("duxiumeta-verify-cancel").addEventListener("command", function () {
    finish(false);
  });

  browser.setAttribute("src", url);
})();
