// Prints an HTML file to PDF with Electron's Chromium (no window shown):
//
//   npx electron --ozone-platform=headless scripts/html-to-pdf.cjs <in.html> <out.pdf>
//
// Used for docs/win-chance/report.pdf (scripts/win-chance-report.ts).
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const [input, output] = process.argv.slice(-2);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL(pathToFileURL(resolve(input)).href);
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  const pdf = await win.webContents.printToPDF({
    pageSize: "A4",
    printBackground: true,
    margins: { top: 0.7, bottom: 0.7, left: 0.75, right: 0.75 },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  writeFileSync(output, pdf);
  app.quit();
});
