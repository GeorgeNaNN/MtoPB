const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const https = require("node:https");
const { DOMParser } = require("@xmldom/xmldom");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const YAML = require("yaml");
const { PDFDocument } = require("pdf-lib");

const appRoot = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, "..");
const codeRoot = app.getAppPath();
const projectRoot = path.resolve(process.env.MTOPB_PROJECT_ROOT || appRoot);
const dataRoot = path.join(projectRoot, "data");
const outputDir = path.join(projectRoot, "res");
const configPath = path.join(projectRoot, "config.yml");
function readConfiguredVersionTag() {
    const document = YAML.parseDocument(fs.readFileSync(configPath, "utf8"));
    if (document.errors.length) throw new Error(`config.yml 格式错误：${document.errors[0].message}`);
    const parsed = document.toJS();
    if (parsed.version === undefined || parsed.version === null) throw new Error("config.yml 缺少 version 配置。");
    const versionTag = String(parsed.version).trim();
    if (!versionTag) throw new Error("config.yml 中的 version 不能为空。");
    return versionTag;
}
function readConfiguredVersion() { return readConfiguredVersionTag().replace(/^v/i, ""); }
const appVersion = readConfiguredVersion();
const releasesUrl = "https://github.com/GeorgeNaNN/MtoPB/releases";
const settingsPath = path.join(dataRoot, "settings.json");
const dataRuntimeRoot = path.join(dataRoot, "runtime");
const profileRoot = path.join(dataRuntimeRoot, "profile");
const userData = path.join(profileRoot, "user-data");
const runtimeTemp = path.join(profileRoot, "temp");
const runtimeCrashDumps = path.join(profileRoot, "crash-dumps");
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(runtimeTemp, { recursive: true });
fs.mkdirSync(runtimeCrashDumps, { recursive: true });
app.setPath("appData", dataRoot);
app.setPath("userData", userData);
app.setPath("sessionData", userData);
app.setPath("temp", runtimeTemp);
app.setPath("crashDumps", runtimeCrashDumps);
app.commandLine.appendSwitch("user-data-dir", userData);

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}
for (const entry of fs.readdirSync(dataRuntimeRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("browser-")) {
        fs.rmSync(path.join(dataRuntimeRoot, entry.name), { recursive: true, force: true });
    }
}
process.env.TEMP = runtimeTemp;
process.env.TMP = runtimeTemp;
const printToken = crypto.randomBytes(24).toString("hex");
let mainWindow;
app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
});
let buildProcess;
let buildStarting = false;
let selectedFiles = [];
let exportPath;
let outputBaseName = "MtoPB";
let lastPdfPath;
let printServer;
const printWindowsByName = new Map;
let outputText = "";
let shuttingDown = false;

function sortMarkdownFiles(files) {
    if (files.length < 2) return { files };
    const entries = files.map(file => {
        const name = path.basename(file);
        const match = name.match(/^(\d+)-.+\.(?:md|markdown)$/i);
        return { file, name, order: match?.[1] };
    });
    const invalid = entries.filter(entry => entry.order === undefined);
    if (invalid.length) {
        return { error: "多个文件时文件名需要使用“数字-名称.md”格式" };
    }
    entries.sort((a, b) => {
        const left = BigInt(a.order);
        const right = BigInt(b.order);
        return (left < right ? -1 : left > right ? 1 : 0) || a.name.localeCompare(b.name, "en");
    });
    return { files: entries.map(entry => entry.file) };
}

function addMarkdownPaths(files) {
    const valid = [];
    for (const value of files) {
        const file = path.resolve(String(value));
        let isFile = false;
        try {
            isFile = fs.statSync(file).isFile();
        } catch {}
        if (!/\.(?:md|markdown)$/i.test(file) || !isFile) {
            return { error: `不是有效的 Markdown 文件：${path.basename(file)}` };
        }
        valid.push(file);
    }
    const merged = [...selectedFiles];
    const seen = new Set(merged.map(file => path.resolve(file).toLowerCase()));
    for (const file of valid) {
        const key = file.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(file);
        }
    }
    const sorted = sortMarkdownFiles(merged);
    if (sorted.error) return sorted;
    selectedFiles = sorted.files;
    lastPdfPath = undefined;
    outputText = "";
    emit({ type: "selection", files: selectedFiles });
    return { files: selectedFiles };
}

function appendBuildLog(title, content) {
    try {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.appendFileSync(path.join(outputDir, `${outputBaseName}.log`), `\n===== ${title} =====\n${content}\n`, "utf8");
    } catch {}
}

function currentDateLabel() {
    const now = new Date;
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
}

function readUiConfig() {
    if (!fs.existsSync(configPath)) throw new Error("找不到主目录中的 config.yml。");
    const yamlDocument = YAML.parseDocument(fs.readFileSync(configPath, "utf8"));
    if (yamlDocument.errors.length) throw new Error(`config.yml 格式错误：${yamlDocument.errors[0].message}`);
    const parsed = yamlDocument.toJS();
    const coverConfig = parsed?.cover;
    const pageConfig = parsed?.page;
    if (!coverConfig || typeof coverConfig !== "object") throw new Error("config.yml 缺少 cover 配置组。");
    if (!pageConfig || typeof pageConfig !== "object") throw new Error("config.yml 缺少 page 配置组。");
    if (!parsed?.watermark || typeof parsed.watermark !== "object") throw new Error("config.yml 缺少 watermark 配置组。");
    if (!parsed?.pdf_metadata || typeof parsed.pdf_metadata !== "object") throw new Error("config.yml 缺少 pdf_metadata 配置组。");
    if (parsed.version === undefined || parsed.version === null) throw new Error("config.yml 缺少 version 配置。");
    if (!Array.isArray(coverConfig.covers)) throw new Error("config.yml 中的 cover.covers 必须是数组。");
    const config = {
        version: String(parsed.version).trim().replace(/^v/i, ""),
        selected_cover: coverConfig.selected_cover,
        cover_type: coverConfig.cover_type,
        custom_cover_pdf: coverConfig.custom_cover_pdf,
        covers: coverConfig.covers,
        watermark: structuredClone(parsed.watermark),
        toc_title: pageConfig.toc_title,
        toc_depth: pageConfig.toc_depth,
        page_size: pageConfig.page_size,
        page_margin: pageConfig.page_margin,
        link_annotation_color: pageConfig.link_annotation_color,
        page_number_start: pageConfig.page_number_start,
        code_line_numbers: pageConfig.code_line_numbers,
        image_pagination: pageConfig.image_pagination,
        code_block_pagination: pageConfig.code_block_pagination,
        table_pagination: pageConfig.table_pagination,
        pdf_metadata: structuredClone(parsed.pdf_metadata)
    };
    if (!config.version) throw new Error("config.yml 中的 version 不能为空。");
    const today = currentDateLabel();
    let datesChanged = false;
    for (let index = 0; index < config.covers.length; index += 1) {
        const cover = config.covers[index];
        delete cover.date_auto;
        if (Number(cover.id) >= 2 && Number(cover.id) <= 4 && cover.date !== today) {
            cover.date = today;
            yamlDocument.setIn([ "cover", "covers", index, "date" ], today);
            datesChanged = true;
        }
    }
    if (datesChanged) fs.writeFileSync(configPath, String(yamlDocument), "utf8");
    config.covers = config.covers.filter(cover => fs.existsSync(path.join(projectRoot, "covers", `${cover.id}.html`)));
    if (!config.covers.length) throw new Error("没有找到与配置编号对应的封面模板。");
    if (!config.covers.some(cover => Number(cover.id) === Number(config.selected_cover))) throw new Error("配置中的 selected_cover 没有对应的封面模板。");
    const style = String(config.watermark.style);
    const fontSizes = { ...config.watermark.font_sizes };
    for (const name of [ "diagonal-up", "diagonal", "center", "tiled", "tiled-up", "tiled-horizontal" ]) {
        const size = Number(fontSizes[name]);
        if (!Number.isFinite(size) || size <= 0) throw new Error(`config.yml 缺少有效的 watermark.font_sizes.${name}。`);
    }
    if (!fontSizes[style]) throw new Error(`config.yml 中的 watermark.style 无效：${style}`);
    config.watermark = { ...config.watermark, font_sizes: fontSizes, font_size: fontSizes[style] };
    validateUiConfig(config);
    return config;
}

function mergeUiConfig(defaults, saved) {
    const config = { ...defaults, ...saved, version: defaults.version };
    config.pdf_metadata = { ...defaults.pdf_metadata, ...(saved?.pdf_metadata ?? {}) };
    config.covers = defaults.covers.map(cover => {
        const savedCover = saved?.covers?.find(item => Number(item.id) === Number(cover.id)) ?? {};
        const merged = { ...cover };
        for (const key of Object.keys(cover)) {
            if (key !== "id" && savedCover[key] !== undefined) merged[key] = savedCover[key];
        }
        merged.id = cover.id;
        if (cover.frame_top_cm !== void 0) merged.frame_top_cm = Number(savedCover.frame_top_cm ?? cover.frame_top_cm);
        if (cover.frame_horizontal_cm !== void 0) merged.frame_horizontal_cm = Number(savedCover.frame_horizontal_cm ?? cover.frame_horizontal_cm);
        if (cover.frame_bottom_cm !== void 0) merged.frame_bottom_cm = Number(savedCover.frame_bottom_cm ?? cover.frame_bottom_cm);
        if (Number(cover.id) >= 2 && Number(cover.id) <= 4) merged.date = cover.date;
        return merged;
    });
    const watermark = saved?.watermark ?? {};
    const style = watermark.style ?? defaults.watermark.style;
    const opacity = Number(watermark.opacity ?? defaults.watermark.opacity);
    const fontSizes = { ...defaults.watermark.font_sizes, ...(watermark.font_sizes ?? {}) };
    config.watermark = {
        enabled: watermark.enabled ?? defaults.watermark.enabled,
        text: watermark.text ?? defaults.watermark.text,
        style: style,
        color: watermark.color ?? defaults.watermark.color,
        opacity: opacity,
        font_size: fontSizes[style],
        font_sizes: fontSizes
    };
    if (!config.covers.some(cover => Number(cover.id) === Number(config.selected_cover))) throw new Error("已保存的封面编号在 config.yml 中不存在。");
    return config;
}

function saveUiConfig(config) {
    if (!config || !Array.isArray(config.covers)) throw new Error("未收到有效的设置。");
    validateUiConfig(config);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const pending = `${settingsPath}.tmp`;
    try {
        fs.writeFileSync(pending, JSON.stringify({ version: 1, config }, null, 2), "utf8");
        fs.renameSync(pending, settingsPath);
    } finally {
        fs.rmSync(pending, { force: true });
    }
}

function readCoverImage(value) {
    const imagePath = path.resolve(projectRoot, String(value ?? ""));
    const mime = ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" })[path.extname(imagePath).toLowerCase()];
    if (!value || !mime || !fs.statSync(imagePath).isFile()) throw new Error("图片不存在或格式不支持。");
    return { path: imagePath, name: path.basename(imagePath), dataUrl: `data:${mime};base64,${fs.readFileSync(imagePath).toString("base64")}` };
}

async function inspectCoverPdf(value) {
    const pdfPath = path.resolve(String(value ?? ""));
    if (path.extname(pdfPath).toLowerCase() !== ".pdf") throw new Error("自定义封面只支持 PDF 文件。");
    if (!fs.statSync(pdfPath).isFile()) throw new Error("找不到所选的封面 PDF。");
    const document = await PDFDocument.load(fs.readFileSync(pdfPath), { updateMetadata: false });
    if (document.getPageCount() !== 1) throw new Error("自定义封面 PDF 必须恰好包含 1 页。");
    const page = document.getPage(0);
    const { width, height } = page.getSize();
    return { path: pdfPath, name: path.basename(pdfPath), pages: 1, width, height };
}

function validateUiConfig(config) {
    if (!String(config?.version).trim()) throw new Error("项目版本号不能为空。");
    for (const key of ["title", "author", "subject", "keywords"]) {
        if (typeof config?.pdf_metadata?.[key] !== "string") throw new Error(`config.yml 中 PDF 元数据的 ${key} 必须是文本。`);
    }
    if (!config || !Array.isArray(config.covers) || config.covers.length === 0) {
        throw new Error("至少需要保留一个封面配置。");
    }
    if (!Number.isInteger(Number(config.selected_cover)) || Number(config.selected_cover) < 1) {
        throw new Error("当前封面编号必须是正整数。");
    }
    const ids = new Set;
    for (const cover of config.covers) {
        const coverId = Number(cover.id);
        if (!Number.isInteger(coverId) || coverId < 1) throw new Error("封面编号必须是正整数。");
        if (ids.has(coverId)) throw new Error("封面编号不能重复。");
        ids.add(coverId);
        if (typeof cover.main_title !== "string") throw new Error(`封面 ${coverId} 的主标题必须是文本。`);
        if (coverId === 1) {
            if (typeof cover.subtitle !== "string") throw new Error("封面 1 的副标题必须是文本。");
            if (typeof cover.link_text !== "string") throw new Error("封面 1 的链接显示文字必须是文本。");
            if (typeof cover.link_url !== "string") throw new Error("封面 1 的链接地址必须是文本。");
            if (!/^#[0-9a-f]{6}$/i.test(String(cover.link_color))) throw new Error("封面 1 的链接显示文字颜色格式不正确。");
            if (typeof cover.use_image !== "boolean") throw new Error("封面 1 的图片开关必须是开启或关闭。");
            const width = Number(cover.image_width_percent);
            if (!Number.isFinite(width) || width < 0) throw new Error("封面 1 的图片宽度必须是大于或等于 0 的数字。");
        }
        if (coverId === 3 && typeof cover.subtitle !== "string") throw new Error("封面 3 的副标题必须是文本。");
        if ([2, 3, 4].includes(coverId)) {
            if (typeof cover.author !== "string" || typeof cover.date !== "string") throw new Error(`封面 ${coverId} 的作者和日期必须是文本。`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(cover.date)) throw new Error(`封面 ${coverId} 的日期必须使用 YYYY-MM-DD 格式。`);
        }
        if (coverId === 4) {
            for (const key of ["frame_top_cm", "frame_horizontal_cm", "frame_bottom_cm"]) {
                const offset = Number(cover[key]);
                if (!Number.isFinite(offset) || offset < 0) throw new Error("封面 4 的矩形距离必须是大于或等于 0 的数字。");
            }
        }
    }
    if (!ids.has(Number(config.selected_cover))) throw new Error("当前封面编号不存在。");
    if (!["template", "custom"].includes(config.cover_type)) throw new Error("封面类型无效。");
    if (typeof config.toc_title !== "string") throw new Error("目录标题必须是文本。");
    if (![1, 2, 3, 4, 5, 6].includes(Number(config.toc_depth))) throw new Error("目录最大层级应在 1 到 6 之间。");
    if (!["A3", "A4", "A5", "Letter", "Legal"].includes(String(config.page_size))) throw new Error("纸张大小无效。");
    if (typeof config.page_margin !== "string" || !config.page_margin.trim()) throw new Error("页边距配置不能为空。");
    if (typeof config.code_line_numbers !== "boolean") throw new Error("代码行号设置必须是开启或关闭。");
    for (const [key, label] of [["image_pagination", "图片"], ["code_block_pagination", "代码块"], ["table_pagination", "表格"]]) {
        if (!["auto", "avoid"].includes(String(config[key]))) throw new Error(`${label}分页设置无效。`);
    }
    if (!/^#[0-9a-f]{6}$/i.test(String(config.link_annotation_color))) throw new Error("正文链接文字颜色格式不正确。");
    if (!["cover", "toc", "body"].includes(config.page_number_start)) throw new Error("页码计数规则无效。");
    const watermark = config.watermark;
    if (typeof watermark.enabled !== "boolean") throw new Error("水印开关必须是开启或关闭。");
    if (typeof watermark.text !== "string") throw new Error("水印文字必须是文本。");
    if (!/^#[0-9a-f]{6}$/i.test(String(watermark.color))) throw new Error("水印颜色格式不正确。");
    if (!Number.isFinite(Number(watermark.opacity)) || Number(watermark.opacity) < 0 || Number(watermark.opacity) > 1) throw new Error("水印透明度应在 0% 到 100% 之间。");
    if (!Number.isFinite(Number(watermark.font_size)) || Number(watermark.font_size) <= 0) throw new Error("水印字号必须是大于 0 的数字。");
    if (!["center", "diagonal", "diagonal-up", "tiled", "tiled-up", "tiled-horizontal"].includes(watermark.style)) throw new Error("水印样式无效。");
    for (const style of ["center", "diagonal", "diagonal-up", "tiled", "tiled-up", "tiled-horizontal"]) {
        if (!Number.isFinite(Number(watermark.font_sizes?.[style])) || Number(watermark.font_sizes[style]) <= 0) {
            throw new Error(`水印样式 ${style} 的字号必须是大于 0 的数字。`);
        }
    }
}


const devToolsPort = 40000 + process.pid % 20000;
const devToolsEndpoint = `http://127.0.0.1:${devToolsPort}`;
app.commandLine.appendSwitch("remote-debugging-port", String(devToolsPort));
app.commandLine.appendSwitch("remote-allow-origins", "*");
app.commandLine.appendSwitch("lang", "zh-CN");
app.commandLine.appendSwitch("disable-background-networking");
app.disableHardwareAcceleration();

function emit(event) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("build-event", event);
}

function terminateBuildTree(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    if (process.platform !== "win32") {
        child.kill("SIGTERM");
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore"
        });
        killer.once("error", () => {
            child.kill();
            resolve();
        });
        killer.once("close", () => resolve());
    });
}

function scheduleRuntimeCleanup() {
    const cleanupScript = `
        const fs = require("node:fs");
        const parentPid = Number(process.env.MTOPB_CLEANUP_PARENT);
        const target = process.env.MTOPB_CLEANUP_TARGET;
        const deadline = Date.now() + 60000;
        const isAlive = pid => {
            try { process.kill(pid, 0); return true; } catch { return false; }
        };
        const timer = setInterval(() => {
            if (isAlive(parentPid) && Date.now() < deadline) return;
            try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
            if (!fs.existsSync(target) || Date.now() >= deadline) {
                clearInterval(timer);
                process.exit(0);
            }
        }, 200);
    `;
    try {
        const helper = spawn(process.execPath, ["-e", cleanupScript], {
            detached: true,
            windowsHide: true,
            stdio: "ignore",
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1",
                MTOPB_CLEANUP_PARENT: String(process.pid),
                MTOPB_CLEANUP_TARGET: dataRuntimeRoot
            }
        });
        helper.unref();
    } catch {}
}

function shutdownApplication() {
    if (shuttingDown) return;
    shuttingDown = true;
    buildStarting = false;
    printServer?.server.close();
    printServer = null;
    const child = buildProcess;
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.destroy();
    }
    printWindowsByName.clear();
    scheduleRuntimeCleanup();
    terminateBuildTree(child).finally(() => app.exit(0));
}

function waitForDevTools(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const check = async () => {
            try {
                const response = await fetch(`${devToolsEndpoint}/json/version`);
                if (response.ok) {
                    const info = await response.json();
                    if (info["User-Agent"]?.includes("MtoPB/")) return resolve(devToolsEndpoint);
                }
            } catch {}
            if (Date.now() >= deadline) return reject(new Error("Chromium did not start its local control endpoint."));
            setTimeout(check, 100);
        };
        check();
    });
}

function startPrintServer() {
    const server = http.createServer(async (request, response) => {
        if (request.method !== "POST" || request.url !== "/pdf" || request.headers.authorization !== `Bearer ${printToken}`) {
            response.writeHead(404).end();
            return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
            size += chunk.length;
            if (size > 64 * 1024 * 1024) {
                response.writeHead(413).end("Request too large");
                return;
            }
            chunks.push(chunk);
        }
        try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const printWindow = printWindowsByName.get(payload.pageName);
            if (!printWindow || printWindow.isDestroyed()) throw new Error("Print page is unavailable.");
            const pdf = await printWindow.webContents.printToPDF(payload.options);
            response.writeHead(200, { "Content-Type": "application/pdf" });
            response.end(Buffer.from(pdf));
        } catch (error) {
            response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end(error.message);
        }
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", reject);
            const address = server.address();
            resolve({ server, endpoint: `http://127.0.0.1:${address.port}/pdf` });
        });
    });
}

function classifyConversionFailure(outputText, logPath) {
    let detail = String(outputText ?? "");
    try {
        detail += `\n${fs.readFileSync(logPath, "utf8").slice(-200000)}`;
    } catch {}
    if (/out of memory|heap out of memory|allocation failed/i.test(detail)) return "Out of memory";
    if (/render-process-gone|target closed|renderer crashed/i.test(detail)) return "Browser rendering process error";
    if (/找不到所需字体文件|所需字体加载失败|Required font file not found|PDF .* font not found|fontkit|font file/i.test(detail)) return "Font file error";
    if (/自定义封面|cover PDF|Custom cover PDF/i.test(detail)) return "Custom cover PDF error";
    if (/PDF 生成失败|PDF (?:rendering|generation) failed|Failed to parse PDF|printToPDF|Chromium did not start/i.test(detail)) return "PDF rendering error";
    if (/网页生成失败|HTML 生成失败|HTML (?:rendering|generation) failed|Generated .*\.html.*failed/i.test(detail)) return "HTML generation error";
    if (/内容校验失败|Validation failed|Content validation failed|Check failed|Markdown.*(?:unsupported|not supported)|配置校验/i.test(detail)) return "Markdown content or configuration validation error";
    if (/YAML|config\.yml|invalid config/i.test(detail)) return "Configuration file error";
    return "Conversion process error";
}

function classifyExportFailure(error) {
    if (error?.code === "EBUSY" || error?.code === "EPERM") return "The destination PDF is in use or cannot be written";
    if (error?.code === "EACCES") return "No write permission at the destination";
    if (error?.code === "ENOENT") return "The destination folder does not exist";
    if (error?.code === "ENOSPC") return "Not enough disk space";
    return "Failed to save the output PDF";
}

function successArt() {
    return [ "     \\O/", "      |    PDF generated successfully!", "     / \\", "" ].join("\n");
}

async function runBuild(files, destinationPath, config) {
    try {
        const endpoint = await waitForDevTools();
        if (shuttingDown) return;
        printServer = await startPrintServer();
        if (shuttingDown) {
            printServer.server.close();
            printServer = null;
            return;
        }
        const jobPath = path.join(profileRoot, "job.json");
        fs.writeFileSync(jobPath, JSON.stringify({ files, config }), "utf8");
        const scriptPath = path.join(codeRoot, "src", "mtopb.mjs");
        const env = {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            MTOPB_PROJECT_ROOT: projectRoot,
            MTOPB_CODE_ROOT: codeRoot,
            MTOPB_JOB_FILE: jobPath,
            MTOPB_OUTPUT_DIR: outputDir,
            MTOPB_OUTPUT_BASENAME: outputBaseName,
            MTOPB_CDP_ENDPOINT: endpoint,
            MTOPB_PRINT_ENDPOINT: printServer.endpoint,
            MTOPB_PRINT_TOKEN: printToken
        };
        buildProcess = spawn(process.execPath, [scriptPath], {
            cwd: projectRoot,
            env,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
        buildProcess.stdout.setEncoding("utf8");
        buildProcess.stderr.setEncoding("utf8");
        buildProcess.stdout.on("data", text => {
            outputText += text;
            emit({ type: "output", stream: "stdout", text });
        });
        buildProcess.stderr.on("data", text => {
            outputText += text;
        });
        buildProcess.on("error", error => {
            appendBuildLog("Conversion process error", error.stack ?? error.message);
            emit({ type: "failed", errorType: "Conversion process error", message: `Conversion failed. Error type: Conversion process error. See res/${outputBaseName}.log or click “View Log” in the lower-left corner.` });
        });
        buildProcess.on("exit", (code, signal) => {
            buildProcess = null;
            buildStarting = false;
            printServer?.server.close();
            printServer = null;
            if (shuttingDown) return;
            if (code === 0) {
                try {
                    const sourcePdf = path.join(outputDir, `${outputBaseName}.pdf`);
                    const internalPdf = path.join(outputDir, path.basename(destinationPath));
                    if (path.resolve(sourcePdf).toLowerCase() !== path.resolve(internalPdf).toLowerCase()) {
                        fs.rmSync(internalPdf, { force: true });
                        fs.renameSync(sourcePdf, internalPdf);
                    }
                    if (path.resolve(internalPdf).toLowerCase() !== path.resolve(destinationPath).toLowerCase()) {
                        fs.copyFileSync(internalPdf, destinationPath);
                    }
                    lastPdfPath = destinationPath;
                    emit({ type: "output", stream: "stdout", text: successArt() });
                    emit({ type: "success", pdfPath: destinationPath });
                } catch (error) {
                    appendBuildLog("PDF export error", error.stack ?? error.message);
                    const errorType = classifyExportFailure(error);
                    const logName = `${outputBaseName}.log`;
                    emit({ type: "failed", errorType: errorType, message: `PDF export failed. Error type: ${errorType}. See res/${logName} or click “View Log” in the lower-left corner.` });
                }
            } else {
                const errorType = classifyConversionFailure(outputText, path.join(outputDir, `${outputBaseName}.log`));
                emit({ type: "failed", errorType: errorType, message: `Conversion failed. Error type: ${errorType}. See res/${outputBaseName}.log or click “View Log” in the lower-left corner.` });
            }
        });
    } catch (error) {
        if (shuttingDown) return;
        buildStarting = false;
        printServer?.server.close();
        printServer = null;
        appendBuildLog("Conversion startup error", error.stack ?? error.message);
        emit({ type: "failed", errorType: "Conversion startup error", message: `Conversion failed. Error type: Conversion startup error. See res/${outputBaseName}.log or click “View Log” in the lower-left corner.` });
    }
}

ipcMain.handle("select-markdown", async () => {
    if (buildStarting || buildProcess) return { files: selectedFiles, busy: true };
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择 Markdown 文件",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Markdown 文件", extensions: ["md", "markdown"] }]
    });
    if (result.canceled) return { canceled: true };
    return addMarkdownPaths(result.filePaths);
});

ipcMain.handle("add-markdown", (_event, files) => {
    if (buildStarting || buildProcess) return { error: "转换正在进行中。" };
    if (!Array.isArray(files)) return { error: "未收到有效的文件列表。" };
    return addMarkdownPaths(files);
});

ipcMain.handle("remove-markdown", (_event, file) => {
    if (buildStarting || buildProcess) return { error: "转换正在进行中。" };
    const target = path.resolve(String(file)).toLowerCase();
    selectedFiles = selectedFiles.filter(item => path.resolve(item).toLowerCase() !== target);
    lastPdfPath = undefined;
    emit({ type: "selection", files: selectedFiles });
    return { files: selectedFiles };
});

ipcMain.handle("clear-markdown", () => {
    if (buildStarting || buildProcess) return { error: "转换正在进行中。" };
    selectedFiles = [];
    lastPdfPath = undefined;
    emit({ type: "selection", files: selectedFiles });
    return { files: selectedFiles };
});

ipcMain.handle("start-build", async (_event, config) => {
    if (buildStarting || buildProcess) return { error: "转换正在进行中。" };
    buildStarting = true;
    try {
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(outputDir, { recursive: true });
    } catch (error) {
        buildStarting = false;
        console.error(`ERROR: could not clear output directory: ${error.message}`);
        return { error: `无法清空 res 文件夹：${error.message}` };
    }
    if (!selectedFiles.length) {
        buildStarting = false;
        return { error: "请先选择 Markdown 文件。" };
    }
    try {
        validateUiConfig(config);
        if (config.cover_type === "custom") await inspectCoverPdf(config.custom_cover_pdf);
    } catch (error) {
        buildStarting = false;
        return { error: error.message };
    }
    let result;
    try {
        const suggestedBaseName = selectedFiles.length === 1
            ? path.basename(selectedFiles[0], path.extname(selectedFiles[0]))
            : "MtoPB";
        const exportDirectory = exportPath ? path.dirname(exportPath) : app.getPath("desktop");
        result = await dialog.showSaveDialog(mainWindow, {
            title: "选择 PDF 保存位置和文件名",
            defaultPath: path.join(exportDirectory, `${suggestedBaseName}.pdf`),
            buttonLabel: "保存并开始转换",
            filters: [{ name: "PDF 文件", extensions: ["pdf"] }]
        });
    } catch (error) {
        buildStarting = false;
        return { error: `无法打开 PDF 保存对话框：${error.message}` };
    }
    if (result.canceled || !result.filePath) {
        buildStarting = false;
        return { canceled: true };
    }
    exportPath = /\.pdf$/i.test(result.filePath) ? result.filePath : `${result.filePath}.pdf`;
    outputBaseName = path.basename(exportPath, path.extname(exportPath)) || "MtoPB";
    lastPdfPath = undefined;
    outputText = "";
    emit({ type: "started", files: selectedFiles });
    runBuild(selectedFiles, exportPath, config);
    return { started: true };
});

ipcMain.handle("open-log", async () => {
    const logPath = path.join(outputDir, `${outputBaseName}.log`);
    if (!fs.existsSync(logPath)) return { error: "还没有可查看的转换日志" };
    const error = await shell.openPath(logPath);
    return error ? { error: `无法打开转换日志：${error}` } : { opened: true };
});
ipcMain.handle("open-pdf", () => lastPdfPath ? shell.openPath(lastPdfPath) : "PDF 尚未生成。");

ipcMain.handle("open-external-link", async (_event, value) => {
    try {
        const url = String(value ?? "").trim();
        if (!url) throw new Error("链接地址为空。");
        await shell.openExternal(url);
        return { opened: true };
    } catch (error) {
        return { error: error.message };
    }
});
ipcMain.handle("check-updates", async () => {
    try {
        const currentVersion = readConfiguredVersionTag();
        const feedXml = await new Promise((resolve, reject) => {
            const request = https.get("https://github.com/GeorgeNaNN/MtoPB/releases.atom", { timeout: 12000 }, response => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", chunk => { body += chunk; });
                response.on("end", () => {
                    if (response.statusCode !== 200) return reject(new Error(`GitHub RSS 返回状态码 ${response.statusCode}`));
                    resolve(body);
                });
            });
            request.on("timeout", () => request.destroy(new Error("连接 GitHub 超时")));
            request.on("error", reject);
        });
        let parseError = "";
        const feed = new DOMParser({ errorHandler: {
            warning: () => {},
            error: message => { parseError = message; },
            fatalError: message => { parseError = message; }
        } }).parseFromString(feedXml, "application/xml");
        if (parseError || feed.documentElement?.nodeName !== "feed") throw new Error("GitHub RSS 内容无法解析");
        const firstEntry = feed.getElementsByTagName("entry")[0];
        const latestVersion = firstEntry?.getElementsByTagName("title")[0]?.textContent?.trim();
        if (!latestVersion) throw new Error("GitHub RSS 中没有找到最新发行版版本号");
        return { currentVersion, latestVersion, updateAvailable: latestVersion !== currentVersion, releasesUrl };
    } catch (error) {
        return { error: `检查更新失败：${error.message}` };
    }
});
ipcMain.handle("get-config", () => {
    try {
        const defaults = readUiConfig();
        const saved = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")).config : null;
        const merged = mergeUiConfig(defaults, saved);
        validateUiConfig(merged);
        saveUiConfig(merged);
        return { config: merged, defaults, version: appVersion };
    } catch (error) {
        return { error: error.message };
    }
});
ipcMain.handle("save-config", (_event, config) => {
    try {
        saveUiConfig(config);
        return { saved: true };
    } catch (error) {
        return { error: `设置保存失败：${error.message}` };
    }
});
ipcMain.handle("select-cover-image", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择封面图片",
        properties: ["openFile"],
        filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }]
    });
    if (result.canceled) return { canceled: true };
    try {
        return readCoverImage(result.filePaths[0]);
    } catch (error) {
        return { error: error.message };
    }
});
ipcMain.handle("select-cover-pdf", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "选择一页 PDF 封面", properties: ["openFile"], filters: [{ name: "PDF 文件", extensions: ["pdf"] }] });
    if (result.canceled) return { canceled: true };
    try { return await inspectCoverPdf(result.filePaths[0]); } catch (error) { return { error: error.message }; }
});
ipcMain.handle("validate-cover-pdf", async (_event, value) => {
    try { return await inspectCoverPdf(value); } catch (error) { return { error: error.message }; }
});
ipcMain.handle("get-cover-pdf-preview", async (_event, value) => {
    try {
        const cover = await inspectCoverPdf(value);
        return { ...cover, data: new Uint8Array(fs.readFileSync(cover.path)) };
    } catch (error) {
        return { error: error.message };
    }
});
ipcMain.handle("get-cover-image", (_event, value) => {
    try {
        return readCoverImage(value);
    } catch (error) {
        return { error: error.message };
    }
});

app.whenReady().then(async () => {
    mainWindow = new BrowserWindow({
        width: 1220,
        height: 900,
        minWidth: 980,
        minHeight: 640,
        icon: path.join(appRoot, "ico", "mtopb.ico"),
        backgroundColor: "#eff8ff",
        autoHideMenuBar: true,
        titleBarStyle: "hidden",
        titleBarOverlay: {
            color: "#66a3ce",
            symbolColor: "#ffffff",
            height: 32
        },
        webPreferences: {
            preload: path.join(codeRoot, "src", "electron-preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.on("close", event => {
        if (shuttingDown) return;
        event.preventDefault();
        shutdownApplication();
    });
    await mainWindow.loadURL(pathToFileURL(path.join(codeRoot, "src", "electron-status.html")).href);
    const printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    printWindow.webContents.on("render-process-gone", (_event, details) => {
        if (shuttingDown || !buildProcess) return;
        appendBuildLog("Chromium renderer", `reason=${details.reason}; exitCode=${details.exitCode}; Electron=${process.versions.electron}; Chromium=${process.versions.chrome}`);
    });
    await printWindow.loadURL("about:blank");
    await printWindow.webContents.executeJavaScript('window.name = "mtopb-render-0"');
    printWindowsByName.set("mtopb-render-0", printWindow);
    emit({ type: "ready" });
}).catch(error => {
    emit({ type: "failed", message: error.message });
});

app.on("before-quit", event => {
    if (shuttingDown) return;
    event.preventDefault();
    shutdownApplication();
});

app.on("window-all-closed", shutdownApplication);

process.on("exit", () => {
    try {
        fs.rmSync(dataRuntimeRoot, { recursive: true, force: true });
    } catch {}
});

