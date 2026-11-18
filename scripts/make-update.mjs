import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const pluginID = manifest.applications.zotero.id;
const repo = process.env.GITHUB_REPOSITORY || "wzs2004/zotero-duxiu-meta";
const tag = process.env.GITHUB_REF_NAME || `v${manifest.version}`;

const update = {
  addons: {
    [pluginID]: {
      updates: [
        {
          version: manifest.version,
          update_link: `https://github.com/${repo}/releases/download/${tag}/duxiumeta.xpi`
        }
      ]
    }
  }
};

fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/update.json", JSON.stringify(update, null, 2) + "\n");
console.log(`Wrote dist/update.json for ${pluginID} ${manifest.version} (${tag})`);
