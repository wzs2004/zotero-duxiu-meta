/* global Zotero, Services, Components, APP_SHUTDOWN */

/**
 * Bootstrap entry point for Zotero 7 - 11.
 *
 * The chrome:// registration pattern below is the one used by the official
 * "Make It Red" example and by most Zotero 7+ plugins: it lets the plugin ship
 * privileged XHTML windows (search dialog, preferences pane) without an
 * install.rdf / XUL overlay.
 */

var chromeHandle;

function install() {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;

  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "duxiumeta", rootURI + "chrome/content/"],
  ]);

  // Load into the bootstrap global so that `Zotero`, `Services` and friends
  // resolve exactly as they do for the official Make It Red example.
  for (let script of ["core.js", "duxiumeta.js"]) {
    let uri = rootURI + "chrome/content/scripts/" + script;
    Services.scriptloader.loadSubScript(uri);
  }

  await Zotero.DuxiuMeta.startup({ id: id, version: version, rootURI: rootURI });
}

async function onMainWindowLoad({ window }, reason) {
  Zotero.DuxiuMeta && Zotero.DuxiuMeta.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  Zotero.DuxiuMeta && Zotero.DuxiuMeta.onMainWindowUnload(window);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  try {
    if (typeof Zotero === "undefined") {
      Zotero = Components.classes["@zotero.org/Zotero;1"]
        .getService(Components.interfaces.nsISupports)
        .wrappedJSObject;
    }
    Zotero.DuxiuMeta && Zotero.DuxiuMeta.shutdown();
  }
  catch (e) {
    // Zotero is already going away
  }

  try {
    Components.utils.unload(rootURI + "chrome/content/scripts/core.js");
    Components.utils.unload(rootURI + "chrome/content/scripts/duxiumeta.js");
  }
  catch (e) {}

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall() {}
