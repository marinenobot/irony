// Compare the current working tree with an unchanged Git revision.
// npm install --no-save playwright && npx playwright install chromium
// node scripts/check-css.cjs <baseline-ref>
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
(async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const baselineRef = process.argv[2];
  if (!baselineRef)
    throw Error("Usage: node scripts/check-css.cjs <baseline-ref>");
  const sha = execFileSync(
    "git",
    ["rev-parse", "--verify", "--end-of-options", baselineRef + "^{commit}"],
    { cwd: projectRoot, encoding: "utf8" },
  ).trim();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "irony-css-"));
  const baselineDir = path.join(tempRoot, "baseline");
  fs.mkdirSync(baselineDir);
  const archive = execFileSync("git", ["archive", "--format=tar", sha], {
    cwd: projectRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  execFileSync("tar", ["--no-same-owner", "-x", "-C", baselineDir], {
    input: archive,
  });
  const roots = { "css-baseline": baselineDir, irony: projectRoot };
  const server = http.createServer((req, res) => {
    const parts = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    )
      .split("/")
      .filter(Boolean);
    const folder = roots[parts.shift()];
    if (!folder) {
      res.writeHead(404);
      res.end();
      return;
    }
    let filename = path.resolve(folder, parts.join("/") || "index.html");
    if (parts.length && req.url.split("?")[0].endsWith("/"))
      filename = path.join(
        filename === folder ? folder : filename,
        "index.html",
      );
    if (!filename.startsWith(folder + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filename, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".json": "application/json",
        }[path.extname(filename)] || "text/plain",
      );
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  // Optional overrides support a preinstalled browser in constrained CI runtimes.
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CSS_TEST_BROWSER || undefined,
    args: JSON.parse(process.env.CSS_TEST_BROWSER_ARGS || "[]"),
  });
  const outputs = new Map(),
    errors = [];
  let count = 0;
  async function capture(page, key, project) {
    await page.mouse.move(0, 0);
    const snapshot = await page.evaluate(() =>
      [...document.querySelectorAll("body,body *")]
        .filter(
          (el) =>
            !["SCRIPT", "LINK", "STYLE"].includes(el.tagName) &&
            el.getClientRects().length,
        )
        .map((el) => {
          function style(pseudo) {
            const st = getComputedStyle(el, pseudo);
            if (
              pseudo &&
              (!st.content || st.content === "none" || st.content === "normal")
            )
              return {};
            const props =
              "display position top right bottom left z-index width min-width max-width height min-height max-height box-sizing padding-top padding-right padding-bottom padding-left margin-top margin-right margin-bottom margin-left border-top-width border-right-width border-bottom-width border-left-width border-top-color border-right-color border-bottom-color border-left-color border-top-style border-right-style border-bottom-style border-left-style border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius background-color background-image background-size background-position color opacity box-shadow outline-color outline-width outline-style outline-offset font-family font-size font-weight font-style font-variant-numeric line-height letter-spacing text-align white-space word-break overflow overflow-x overflow-y align-items align-self justify-content justify-self flex flex-direction grid-template-columns grid-template-rows grid-template-areas grid-column grid-row gap transform transform-origin content cursor pointer-events appearance -webkit-text-fill-color".split(
                " ",
              );
            // Auto margins can resolve differently immediately after closing an
            // overlay; actual container and child coordinates are checked too.
            const measuredProps = el.classList.contains("container")
              ? props.filter((p) => p !== "margin-left" && p !== "margin-right")
              : props;
            return Object.fromEntries(
              measuredProps.map((p) => [p, st.getPropertyValue(p)]),
            );
          }
          const r = el.getBoundingClientRect();
          return {
            id: el.id,
            cls: typeof el.className === "string" ? el.className : "SVG",
            rect: [r.x, r.y, r.width, r.height],
            style: style(),
            before: style("::before"),
            after: style("::after"),
          };
        }),
    );
    if (project === "css-baseline") outputs.set(key, snapshot);
    else {
      const baseline = outputs.get(key),
        diffs = [];
      for (let i = 0; i < snapshot.length; i++) {
        const a = baseline[i],
          b = snapshot[i];
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
        const d = {
          node: b.id || b.cls,
          rect:
            JSON.stringify(a.rect) !== JSON.stringify(b.rect)
              ? [a.rect, b.rect]
              : undefined,
        };
        for (const part of ["style", "before", "after"]) {
          const changed = Object.keys(a[part]).filter(
            (p) => a[part][p] !== b[part][p],
          );
          if (changed.length)
            d[part] = Object.fromEntries(
              changed.map((p) => [p, [a[part][p], b[part][p]]]),
            );
        }
        if (d.rect || d.style || d.before || d.after) diffs.push(d);
      }
      if (diffs.length) {
        fs.writeFileSync(
          path.join(tempRoot, "differences.json"),
          JSON.stringify({ key, diffs }, null, 2),
        );
        console.log(key, JSON.stringify(diffs.slice(0, 6)));
        throw Error(
          "Style comparison failed; details: " +
            path.join(tempRoot, "differences.json"),
        );
      }
      count++;
    }
  }
  for (const width of (process.env.QA_WIDTHS || "390,1024,320")
    .split(",")
    .map(Number)) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    for (const project of ["css-baseline", "irony"]) {
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) =>
        route
          .request()
          .url()
          .startsWith(origin + "/")
          ? route.continue()
          : route.abort(),
      );
      await page.addInitScript(() => {
        localStorage.clear();
        window.ARRIVAL_FIREBASE_CONFIG = {};
        localStorage.setItem("rallyGuidedDemoSeenV1", "1");
        localStorage.setItem(
          "arrivalMarineSettings",
          JSON.stringify({
            rallyMin: 5,
            prepTime: 30,
            members: [
              { name: "マリン", march: 40 },
              { name: "カイ", march: 62 },
            ],
          }),
        );
        localStorage.setItem(
          "pets",
          JSON.stringify({
            カイ: {
              status: "active",
              endTime: Date.parse("2026-10-22T14:00:00Z"),
            },
          }),
        );
      });
      await page.clock.install({ time: new Date("2026-10-22T12:00:00Z") });
      await page.clock.setFixedTime(new Date("2026-10-22T12:00:00Z"));
      for (const theme of (
        process.env.QA_THEMES || "light,mint,cookies,truffle,dark"
      ).split(",")) {
        await page.goto(`${origin}/${project}/`);
        await page.waitForFunction(
          () => document.querySelector("#utc-now").textContent !== "--:--:--",
        );
        // Clipboard promises resolve at different times across browser contexts.
        // Keep transient copy confirmations out of the layout comparison.
        await page.addStyleTag({
          content:
            ":is(#qa-a#qa-b#qa-c,html) *,:is(#qa-a#qa-b#qa-c,html) *::before,:is(#qa-a#qa-b#qa-c,html) *::after{transition:none !important;animation:none !important;}#toast{opacity:0 !important;}",
        });
        await page.evaluate(
          (t) => document.querySelector(`[data-theme-choice="${t}"]`).click(),
          theme,
        );
        for (const tab of ["page-landing", "page-calc", "page-switch"]) {
          await page.locator(`[data-page="${tab}"]`).click();
          await capture(page, `${width}/${theme}/${tab}`, project);
          await page.keyboard.press("Tab");
          await page.locator(`#${tab} .btn-primary`).focus();
          await capture(
            page,
            `${width}/${theme}/${tab}-keyboard-focus`,
            project,
          );
          await page.evaluate(() => document.activeElement.blur());
          await page.evaluate((tab) => {
            const button = document.querySelector("#" + tab + " .btn-primary");
            button.disabled = true;
            if (tab === "page-calc") button.classList.add("calculating");
          }, tab);
          await capture(page, `${width}/${theme}/${tab}-disabled`, project);
          await page.evaluate((tab) => {
            const b = document.querySelector("#" + tab + " .btn-primary");
            b.disabled = false;
            b.classList.remove("calculating");
          }, tab);
        }
        await page.locator('[data-page="page-calc"]').click();
        await page.locator("#action-btn").click();
        await page.waitForTimeout(650);
        await capture(page, `${width}/${theme}/calculated`, project);
        await page.locator("#preview-toggle").click();
        await page.locator("#players .member-settings-toggle").first().click();
        await capture(page, `${width}/${theme}/expanded`, project);
        await page.locator("#rally-row").click();
        await capture(page, `${width}/${theme}/presets`, project);
        await page.locator('[data-role="custom"]').click();
        await page.waitForTimeout(300);
        await capture(page, `${width}/${theme}/custom-time`, project);
        await page.locator("#departure-edit-close").click();
        await page.locator("#app-settings-button").click();
        await capture(page, `${width}/${theme}/menu`, project);
        await page.locator("#quick-theme-btn").click();
        await capture(page, `${width}/${theme}/theme-menu`, project);
      }
      await page.close();
      console.log(`${project} ${width}px: all scenarios captured`);
    }
  }
  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log(
    `${count} full computed-style + geometry + pseudo-element comparisons passed.`,
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
