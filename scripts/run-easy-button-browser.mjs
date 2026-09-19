import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";

const playwrightModule = process.env.PLAYWRIGHT_MODULE || path.join(process.env.TEMP || "/tmp", "sd-3d-qa/node_modules/playwright/index.mjs");
const { chromium } = await import(pathToFileURL(playwrightModule));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = http.createServer((req, res) => {
  const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    res.setHeader("Content-Type", ({".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".html":"text/html",".json":"application/json"})[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.stack));
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/test-easy-button-browser.html`);
  await page.waitForFunction(() => ["READY", "FAIL"].includes(document.title));
  assert.equal(await page.title(), "READY", await page.locator("#result").textContent());
  assert.deepEqual(errors, []);
  const result = await page.evaluate(() => qa);
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "tests/easy-button-results.json"), JSON.stringify(result, null, 2) + "\n");
  await page.screenshot({ path: path.join(root, "tests/easy-button-preview.png"), fullPage: true });
  console.log(`PASS: ${result.checks.length} Easy Button browser checks`);
} finally {
  await browser.close();
  server.close();
}
