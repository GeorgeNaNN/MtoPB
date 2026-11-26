/*
                            _ooOoo_
                           o8888888o
                           88" . "88
                           (| -_- |)
                            O\ = /O
                        ____/`---'\____
                      .   ' \\| |// `.
                       / \||| : |||// \
                    / _||||| -卍- |||||- \
                       | | \\\ - /// | |
                     | \_| ''\---/'' | |
                      \ .-\__ `-` ___/-. /
                   ___`. .' /--.--\ `. . __
                ."" '< `.___\_<|>_/___.' >'"".
               | | : `- \`.;`\ _ /`;.`/ - ` : | |
                 \ \ `-. \_ __\ /__ _/ .-` / /
         ======`-.____`-.___\_____/___.-`____.-'======
                            `=---='

         .............................................
                  佛祖镇楼                  BUG辟易
          佛曰:
                  写字楼里写字间，写字间里程序员；
                  程序人员写程序，又拿程序换酒钱；
                  酒醒只在网上坐，酒醉还来网下眠；
                  酒醉酒醒日复日，网上网下年复年；
                  但愿老死电脑间，不愿鞠躬老板前；
                  奔驰宝马贵者趣，公交自行程序员；
                  别人笑我忒疯癫，我笑自己命太贱；
                  不见满街漂亮妹，哪个归得程序员？
*/
import { execSync } from "node:child_process";

import fs from "node:fs";

import path from "node:path";

import { fileURLToPath, pathToFileURL } from "node:url";

import { createRequire } from "node:module";

import hljs from "highlight.js/lib/common";

import MarkdownIt from "markdown-it";

import markdownItAnchorModule from "markdown-it-anchor";

import markdownItContainerModule from "markdown-it-container";

import markdownItMarkModule from "markdown-it-mark";

import markdownItTaskListsModule from "markdown-it-task-lists";

import markdownItGithubAlertsModule from "markdown-it-github-alerts";

import markdownItKatexModule from "@vscode/markdown-it-katex";

import YAML from "yaml";

import { normalizeChapters, isValidClassAttr } from "./lib/chapters.mjs";

import { normalizeMarkdownImagePaths } from "./lib/markdown-images.mjs";

import gfmStrikethrough from "./lib/gfm-strikethrough.mjs";

const require2 = createRequire(import.meta.url);

const interop = mod => mod && typeof mod === "object" && "default" in mod ? mod.default : mod;

const anchorPlugin = interop(markdownItAnchorModule);

const containerPlugin = interop(markdownItContainerModule);

const markPlugin = interop(markdownItMarkModule);

const taskListsPlugin = interop(markdownItTaskListsModule);

const githubAlertsPlugin = interop(markdownItGithubAlertsModule);

const katexPlugin = interop(markdownItKatexModule);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const toolRoot = path.resolve(scriptDir, "..");

const templatesDir = path.join(toolRoot, "templates");

const toPosix = p => p.split(path.sep).join("/");

function resolveConfigPath() {
    const i = process.argv.indexOf("--config");
    if (i !== -1) {
        const value = process.argv[i + 1];
        if (!value) {
            console.error("ERROR: A file path is required after --config (for example, --config book.yml).");
            process.exit(1);
        }
        return path.resolve(process.cwd(), value);
    }
    return path.resolve(process.cwd(), "book.yml");
}

const configPath = resolveConfigPath();

const baseDir = path.dirname(configPath);

if (!fs.existsSync(configPath)) {
    console.error(`ERROR: Configuration file not found: ${configPath}`);
    process.exit(1);
}

let book;

try {
    book = YAML.parse(fs.readFileSync(configPath, "utf8"));
} catch (err) {
    console.error(`ERROR: Could not parse ${path.basename(configPath)}: ${err.message}`);
    process.exit(1);
}

if (!book || typeof book !== "object") {
    console.error(`ERROR: ${path.basename(configPath)} is empty or is not a valid YAML mapping.`);
    process.exit(1);
}

for (const key of ["title", "subtitle", "version", "language", "date", "date_format"]) {
    if (typeof book[key] !== "string") throw new Error(`book.yml is missing a valid ${key} setting.`);
}
if (!book.date_format.trim()) throw new Error("book.yml is missing a valid date_format setting.");
if (!Array.isArray(book.authors)) throw new Error("book.yml authors must be an array.");
for (const key of ["output", "metadata", "toc", "chapter_toc", "labels", "pdf", "cover", "back_cover", "style"]) {
    if (!book[key] || typeof book[key] !== "object") throw new Error(`book.yml is missing the ${key} configuration group.`);
}
for (const key of ["html", "pdf"]) {
    if (typeof book.output[key] !== "string" || !book.output[key]) throw new Error(`book.yml is missing output.${key}.`);
}
for (const key of ["enabled", "title", "depth"]) {
    if (book.toc[key] === undefined || book.toc[key] === null) throw new Error(`book.yml is missing toc.${key}.`);
}
for (const key of ["default", "title", "depth", "class"]) {
    if (book.chapter_toc[key] === undefined || book.chapter_toc[key] === null) throw new Error(`book.yml is missing chapter_toc.${key}.`);
}
for (const key of ["code_line_numbers", "custom_css", "fonts"]) {
    if (book.style[key] === undefined || book.style[key] === null) throw new Error(`book.yml is missing style.${key}.`);
}
for (const key of ["header_footer", "cover_header_footer", "page_numbers", "header", "footer", "header_footer_style", "date_format", "page_size", "margin", "image_pagination", "code_block_pagination", "table_pagination"]) {
    if (book.pdf[key] === undefined || book.pdf[key] === null) throw new Error(`book.yml is missing pdf.${key}.`);
}
for (const key of ["image_pagination", "code_block_pagination", "table_pagination"]) {
    if (!["auto", "avoid"].includes(book.pdf[key])) throw new Error(`book.yml has an invalid pdf.${key} setting.`);
}
for (const key of ["enabled"]) {
    if (typeof book.cover[key] !== "boolean") throw new Error(`book.yml is missing a valid cover.${key} setting.`);
    if (typeof book.back_cover[key] !== "boolean") throw new Error(`book.yml is missing a valid back_cover.${key} setting.`);
}
if (!Array.isArray(book.themes) || book.themes.length === 0) throw new Error("book.yml is missing the themes setting.");

const chaptersResult = normalizeChapters(book, baseDir);

if (chaptersResult.error) {
    console.error(`ERROR: ${chaptersResult.error}`);
    console.error('Run "npm run check" for details.');
    process.exit(1);
}

const chapterEntries = chaptersResult.entries;

const title = book.title;

const subtitle = book.subtitle;

const language = book.language;

const rawDate = book.date;

const dateFormat = book.date_format;

const authors = book.authors.map(String);

const authorsText = authors.join(", ");

const date = formatDate(rawDate, dateFormat);

const bookVersion = book.version;

function resolveGitCommit(dir) {
    try {
        const hash = execSync("git rev-parse --short HEAD", {
            cwd: dir,
            stdio: [ "ignore", "pipe", "ignore" ]
        }).toString().trim();
        if (!hash) return "";
        const dirty = execSync("git status --porcelain", {
            cwd: dir,
            stdio: [ "ignore", "pipe", "ignore" ]
        }).toString().trim();
        return dirty ? `${hash}-dirty` : hash;
    } catch {
        return "";
    }
}

const gitCommit = resolveGitCommit(baseDir);

const htmlOut = path.resolve(baseDir, book.output.html);

const pdfOut = path.resolve(baseDir, book.output.pdf);

const distDir = path.dirname(htmlOut);

const notesDir = path.join(baseDir, "notes");

const tocCfg = book.toc;

const tocEnabled = tocCfg.enabled;

const tocTitle = String(tocCfg.title);

const tocDepth = Math.min(6, Math.max(1, Number(tocCfg.depth)));

const chapterTocCfg = book.chapter_toc;

const chapterTocDefault = chapterTocCfg.default;

const chapterTocTitle = String(chapterTocCfg.title);

const chapterTocDepth = Math.min(6, Math.max(2, Number(chapterTocCfg.depth)));

const chapterTocClass = isValidClassAttr(chapterTocCfg.class) ? String(chapterTocCfg.class).trim() : "";

const DEFAULT_LABELS = {
    note: "Note",
    tip: "Tip",
    warning: "Warning",
    danger: "Danger",
    theorem: "Theorem",
    definition: "Definition",
    example: "Example",
    exercise: "Exercise"
};

const BUILTIN_ADMONITIONS = [ "note", "tip", "warning", "danger" ];

const BUILTIN_ENVS = [ "theorem", "definition", "example", "exercise" ];

const RESERVED_CONTAINER_KEYS = new Set([ ...BUILTIN_ADMONITIONS, ...BUILTIN_ENVS, "pagebreak" ]);

const labels = {
    ...DEFAULT_LABELS
};

const customContainers = [];

for (const [key, raw] of Object.entries(book.labels)) {
    const text = raw === void 0 || raw === null ? "" : String(raw);
    if (RESERVED_CONTAINER_KEYS.has(key)) {
        if (text) labels[key] = text;
        continue;
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) continue;
    customContainers.push({
        key: key,
        text: text || key
    });
}

const styleBase = book.style;

const pdfBase = book.pdf;

const coverBase = book.cover;

const backBase = book.back_cover;

function normalizeThemes(raw) {
    let defaultIndex = raw.findIndex(t => t && t.default === true);
    if (defaultIndex === -1) throw new Error("One item in book.yml themes must set default: true.");
    return raw.map((t, i) => {
        if (!t || typeof t !== "object") throw new Error(`book.yml themes[${i}] must be a configuration object.`);
        for (const key of ["name", "label", "style", "cover", "back_cover", "pdf"]) {
            if (t[key] === undefined || t[key] === null) throw new Error(`book.yml themes[${i}] is missing ${key}.`);
        }
        const name = String(t.name);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
            console.error(`ERROR: Invalid theme name ${JSON.stringify(name)}. It must match [A-Za-z0-9][A-Za-z0-9_-]* (used in output filenames).`);
            process.exit(1);
        }
        return {
            name: name,
            label: String(t.label),
            isDefault: i === defaultIndex,
            style: t.style,
            cover: t.cover,
            back_cover: t.back_cover,
            pdf: t.pdf
        };
    });
}

const themes = normalizeThemes(book.themes);

function variantPath(basePath, theme) {
    if (theme.isDefault) return basePath;
    const ext = path.extname(basePath);
    return path.join(path.dirname(basePath), `${path.basename(basePath, ext)}.${theme.name}${ext}`);
}

function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function resolveHtmlResourceUrl(value, baseDir) {
    const raw = String(value ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(?:https?:|data:|blob:|mailto:|tel:|file:|\/\/)/i.test(raw)) return value;
    if (!/^[A-Za-z]:[\\/]/.test(raw) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return value;
    const suffix = raw.match(/[?#].*$/)?.[0] ?? "";
    const rawPath = suffix ? raw.slice(0, -suffix.length) : raw;
    if (!rawPath) return value;
    let decoded = rawPath;
    try {
        decoded = decodeURIComponent(rawPath);
    } catch {}
    const resolved = path.isAbsolute(decoded) ? decoded : path.resolve(baseDir, decoded);
    return `${pathToFileURL(resolved).href}${suffix}`;
}

function rewriteCssResourceUrls(css, baseDir) {
    return String(css).replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/gi, (whole, quote, quotedValue, bareValue) => {
        const value = (quotedValue ?? bareValue ?? "").trim();
        if (!value) return whole;
        const resolved = resolveHtmlResourceUrl(value, baseDir);
        if (resolved === value) return whole;
        return `url("${resolved.replaceAll('"', '\\"')}")`;
    });
}

function rewriteHtmlResourceAttributes(tag, baseDir) {
    return tag.replace(/\b(src|href|poster|data)\s*=\s*(["'])(.*?)\2/gi, (whole, name, quote, value) => {
        const resolved = resolveHtmlResourceUrl(value, baseDir);
        if (resolved === value) return whole;
        const escaped = resolved.replaceAll(quote, quote === '"' ? "&quot;" : "&#39;");
        return `${name}=${quote}${escaped}${quote}`;
    });
}

function normalizeRawHtmlResources(html, baseDir) {
    let output = String(html);
    const protectedScripts = [];
    output = output.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (whole, open, body, close) => {
        const index = protectedScripts.push(rewriteHtmlResourceAttributes(open, baseDir) + body + close) - 1;
        return `\uE100MTOPB_SCRIPT_${index}\uE101`;
    });
    output = output.replace(/<(img|source|video|audio|iframe|link|object)\b[^>]*>/gi, tag => rewriteHtmlResourceAttributes(tag, baseDir));
    output = output.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (whole, open, css, close) => rewriteHtmlResourceAttributes(open, baseDir) + rewriteCssResourceUrls(css, baseDir) + close);
    output = output.replace(/(\bstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (whole, prefix, quote, css) => prefix + quote + rewriteCssResourceUrls(css, baseDir) + quote);
    return output.replace(/\uE100MTOPB_SCRIPT_(\d+)\uE101/g, (_whole, index) => protectedScripts[Number(index)] ?? "");
}
function styleChineseCodeComments(html) {
    const tokens = html.match(/<span\b[^>]*>|<\/span>|[^<]+|</g) ?? [];
    const spans = [];
    return tokens.map(token => {
        if (/^<span\b/i.test(token)) {
            spans.push(/\bclass="([^"]*)"/.exec(token)?.[1]?.split(/\s+/) ?? []);
            return token;
        }
        if (token === "</span>") {
            spans.pop();
            return token;
        }
        if (spans.some(classes => classes.includes("hljs-comment") || classes.includes("hljs-quote"))) {
            return token.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g, text => `<span class="code-comment-cjk">${text}</span>`);
        }
        return token;
    }).join("");
}

function splitHighlightedLines(html) {
    const sourceLines = html.split("\n");
    if (sourceLines.length > 1 && sourceLines.at(-1) === "") sourceLines.pop();
    const activeSpans = [];
    const lines = [];
    for (const sourceLine of sourceLines.length ? sourceLines : [ "" ]) {
        let line = activeSpans.join("");
        const parts = sourceLine.split(/(<\/?span\b[^>]*>)/g);
        for (const part of parts) {
            if (!part) continue;
            if (/^<span\b/i.test(part)) {
                activeSpans.push(part);
                line += part;
            } else if (part === "</span>") {
                if (activeSpans.length) activeSpans.pop();
                line += part;
            } else {
                line += part;
            }
        }
        line += "</span>".repeat(activeSpans.length);
        lines.push(line);
    }
    return lines;
}

function renderCodeBlock(source, lang, highlighted, withLineNumbers) {
    const languageClass = lang ? ` language-${escapeHtml(lang)}` : "";
    if (!withLineNumbers) return `<pre class="code-block"><code class="hljs${languageClass}">${highlighted}</code></pre>`;
    const rows = splitHighlightedLines(highlighted).map(content => `<span class="code-line">${content || "&nbsp;"}</span>`);
    const lineNumberWidth = `max(1.4em, calc(${String(rows.length).length}ch + 0.25em))`;
    return `<pre class="code-block" style="--line-number-width:${lineNumberWidth}"><code class="hljs${languageClass}" style="counter-reset:code-line">${rows.join("")}</code></pre>`;
}

function dateParts(value) {
    const raw = String(value ?? "").trim();
    const match = raw.match(/^(\d{4})(?:-?(\d{2})(?:-?(\d{2}))?)?/);
    if (!match) return null;
    return {
        YYYY: match[1],
        YY: match[1].slice(-2),
        MM: match[2] ?? "01",
        DD: match[3] ?? "01"
    };
}

function formatDate(value, format = "YYYY-MM-DD") {
    const parts = dateParts(value);
    if (!parts) return String(value ?? "");
    const normalized = String(format).toLowerCase();
    const presets = {
        iso: "YYYY-MM-DD",
        "yyyy-mm-dd": "YYYY-MM-DD",
        yyyymmdd: "YYYYMMDD",
        yymmdd: "YYMMDD",
        "yyyy/mm/dd": "YYYY/MM/DD",
        "yy/mm/dd": "YY/MM/DD",
        "yyyy.mm.dd": "YYYY.MM.DD",
        "yy.mm.dd": "YY.MM.DD"
    };
    const pattern = presets[normalized] ?? String(format);
    return pattern.replaceAll("YYYY", parts.YYYY).replaceAll("yyyy", parts.YYYY).replaceAll("YY", parts.YY).replaceAll("yy", parts.YY).replaceAll("MM", parts.MM).replaceAll("mm", parts.MM).replaceAll("DD", parts.DD).replaceAll("dd", parts.DD);
}

const sanitizeCssValue = v => String(v).replace(/[{}<>;]/g, "").trim();

function mergePdfCfg(base, override) {
    const merged = {
        ...base ?? {},
        ...override ?? {}
    };
    for (const key of [ "page_numbers", "header", "footer", "header_footer_style" ]) {
        if (base?.[key] || override?.[key]) {
            merged[key] = {
                ...base?.[key] ?? {},
                ...override?.[key] ?? {}
            };
        }
    }
    return merged;
}

function marginParts(value) {
    if (typeof value !== "string" || !value.trim()) throw new Error("pdf.margin is missing.");
    const parts = value.trim().split(/\s+/);
    if (parts.length > 4) throw new Error("pdf.margin must contain 1 to 4 valid margin values.");
    const [a, b = a, c = a, d = b] = parts;
    return {
        top: a,
        right: b,
        bottom: c,
        left: d
    };
}

function slugifyHeading(str) {
    return str.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

function renderTemplate(template, values) {
    return template.replace(/\{\{(\w+)\}\}/g, (whole, key) => Object.hasOwn(values, key) ? values[key] : whole);
}

const metaValues = {
    lang: escapeHtml(language),
    title: escapeHtml(title),
    subtitle: escapeHtml(subtitle),
    authors: escapeHtml(authorsText),
    date: escapeHtml(date),
    version: escapeHtml(bookVersion),
    commit: escapeHtml(gitCommit)
};

const printCss = fs.readFileSync(path.join(templatesDir, "print.css"), "utf8");

const documentTemplate = fs.readFileSync(path.join(templatesDir, "document.html"), "utf8");

let katexCssPath;

const bundledKatexCssPath = path.join(toolRoot, "vendor", "katex", "katex.min.css");

try {
    katexCssPath = fs.existsSync(bundledKatexCssPath) ? bundledKatexCssPath : require2.resolve("katex/dist/katex.min.css");
} catch {
    katexCssPath = path.join(path.dirname(require2.resolve("katex")), "katex.min.css");
}

const katexFontsDir = path.join(path.dirname(katexCssPath), "fonts");

const katexCss = fs.readFileSync(katexCssPath, "utf8").replace(/url\(fonts\/([^)]*)\)/g, (_whole, file) => `url("${pathToFileURL(path.join(katexFontsDir, decodeURIComponent(file))).href}")`);

const DEFAULT_COVER = '<h1 class="cover-title">{{title}}</h1>\n<p class="cover-subtitle">{{subtitle}}</p>\n<p class="cover-authors">{{authors}}</p>\n<p class="cover-date">{{date}}</p>' + (bookVersion ? '\n<p class="cover-version">{{version}}</p>' : "");

const DEFAULT_BACK_COVER = '<div class="back-cover-inner">\n<p class="back-cover-title">{{title}}</p>\n<p class="back-cover-meta">{{authors}}</p>\n<p class="back-cover-meta">{{date}}</p>\n' + (bookVersion ? '<p class="back-cover-meta">{{version}}</p>\n' : "") + "</div>";

function loadComponent(file, label) {
    const componentPath = path.resolve(baseDir, String(file));
    if (!fs.existsSync(componentPath)) {
        console.error(`ERROR: ${label} component file not found: ${file}`);
        process.exit(1);
    }
    return renderTemplate(fs.readFileSync(componentPath, "utf8"), metaValues);
}

function resolveProjectOrToolFile(file) {
    const projectPath = path.resolve(baseDir, String(file));
    if (fs.existsSync(projectPath)) return projectPath;
    const toolPath = path.resolve(toolRoot, String(file));
    if (fs.existsSync(toolPath)) return toolPath;
    return projectPath;
}

function buildToc(entries) {
    if (!tocEnabled) return "";
    const items = entries.filter(e => e.level <= tocDepth);
    if (items.length === 0) return "";
    const row = entry => `<div class="toc-row"><span class="toc-title"><a href="#${entry.id}">${entry.titleHtml ?? escapeHtml(entry.title)}</a></span><span class="toc-leader"><span class="toc-leader-dots" aria-hidden="true">${".".repeat(256)}</span></span><span class="toc-page" data-target="${escapeHtml(entry.id)}"></span></div>`;
    const minLevel = Math.min(...items.map(e => e.level));
    let html = '<ol class="toc-list">\n';
    let prev = null;
    for (const entry of items) {
        const level = prev === null ? minLevel : Math.max(minLevel, Math.min(entry.level, prev + 1));
        if (prev === null) {
            html += `<li>${row(entry)}`;
        } else if (level > prev) {
            html += `\n<ol>\n<li>${row(entry)}`;
        } else {
            html += "</li>\n";
            for (let l = prev; l > level; l--) html += "</ol>\n</li>\n";
            html += `<li>${row(entry)}`;
        }
        prev = level;
    }
    html += "</li>\n";
    for (let l = prev; l > minLevel; l--) html += "</ol>\n</li>\n";
    html += "</ol>";
    return `<nav class="toc" id="toc">\n<h2 class="toc-heading">${escapeHtml(tocTitle)}</h2>\n${html}\n</nav>`;
}

function buildChapterToc(headings) {
    const items = headings.filter(e => e.level >= 2 && e.level <= chapterTocDepth);
    if (items.length === 0) return "";
    const minLevel = Math.min(...items.map(e => e.level));
    const rows = items.map(e => {
        const indent = Math.max(0, e.level - minLevel);
        const indentClass = indent > 0 ? ` chapter-toc-l${indent}` : "";
        return `<li class="chapter-toc-row${indentClass}"><span class="chapter-toc-title"><a href="#${escapeHtml(e.id)}">${e.titleHtml ?? escapeHtml(e.title)}</a></span><span class="chapter-toc-leader"><span class="toc-leader-dots" aria-hidden="true">${".".repeat(256)}</span></span><span class="toc-page" data-target="${escapeHtml(e.id)}"></span></li>`;
    }).join("\n");
    const cls = [ "chapter-toc", chapterTocClass ].filter(Boolean).join(" ");
    const heading = chapterTocTitle ? `<p class="chapter-toc-heading">${escapeHtml(chapterTocTitle)}</p>\n` : "";
    return `<nav class="${cls}">\n${heading}<ul class="chapter-toc-list">\n${rows}\n</ul>\n</nav>`;
}

function buildTheme(theme) {
    const styleCfg = {
        ...styleBase,
        ...theme.style
    };
    const pdfCfg = mergePdfCfg(pdfBase, theme.pdf);
    const withCodeLineNumbers = styleCfg.code_line_numbers;
    const coverCfg = {
        ...coverBase,
        ...theme.cover
    };
    const backCfg = {
        ...backBase,
        ...theme.back_cover
    };
    const coverEnabled = coverCfg.enabled;
    const backEnabled = backCfg.enabled;
    const withHeaderFooter = pdfCfg.header_footer;
    const coverHeaderFooter = pdfCfg.cover_header_footer;
    const pageNumberCfg = pdfCfg.page_numbers;
    const countCover = pageNumberCfg.count_cover;
    const coverUsesHeaderFooter = withHeaderFooter && coverHeaderFooter && countCover;
    const htmlOutTheme = variantPath(htmlOut, theme);
    const pdfOutTheme = variantPath(pdfOut, theme);
    const usedSlugs = new Map;
    function uniqueSlug(headingTitle) {
        const base = slugifyHeading(headingTitle) || "section";
        const count = usedSlugs.get(base) ?? 0;
        usedSlugs.set(base, count + 1);
        return count === 0 ? base : `${base}-${count + 1}`;
    }
    const tocEntries = [];
    const md = new MarkdownIt({
        html: true,
        linkify: true,
        typographer: false,
        highlight: (source, lang) => {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return renderCodeBlock(source, lang, styleChineseCodeComments(hljs.highlight(source, {
                        language: lang,
                        ignoreIllegals: true
                    }).value), withCodeLineNumbers);
                } catch {
                    return renderCodeBlock(source, lang, escapeHtml(source), withCodeLineNumbers);
                }
            }
            return renderCodeBlock(source, lang, escapeHtml(source), withCodeLineNumbers);
        }
    });
    md.use(gfmStrikethrough);
    // 1. 行内公式先注册，避免美元符号被其他行内规则误解析。
    md.use(katexPlugin, {
        throwOnError: false,
        errorColor: "#cc0000"
    });
    // 2. 行内高亮和任务列表属于独立的语法扩展。
    md.use(markPlugin);
    md.use(taskListsPlugin, { enabled: false });
    md.use(githubAlertsPlugin, {
        titles: {
            note: "注意",
            tip: "提示",
            important: "重要",
            warning: "警告",
            caution: "危险"
        }
    });
    // 3. 容器插件产生块级结构；标题锚点随后处理所有 Markdown 标题。
    const admonitionDefs = [ ...BUILTIN_ADMONITIONS.map(key => ({
        key: key,
        extraClass: ""
    })), ...customContainers.map(c => ({
        key: c.key,
        extraClass: " admonition-custom",
        text: c.text
    })) ];
    for (const def of admonitionDefs) {
        md.use(containerPlugin, def.key, {
            render(tokens, idx) {
                const token = tokens[idx];
                if (token.nesting === 1) {
                    const custom = token.info.trim().slice(def.key.length).trim();
                    const label = custom || def.text || labels[def.key] || def.key;
                    return `<div class="admonition${def.extraClass} admonition-${def.key}">\n<p class="admonition-title">${escapeHtml(label)}</p>\n`;
                }
                return "</div>\n";
            }
        });
    }
    for (const envType of BUILTIN_ENVS) {
        md.use(containerPlugin, envType, {
            render(tokens, idx) {
                const token = tokens[idx];
                if (token.nesting === 1) {
                    const name = token.info.trim().slice(envType.length).trim();
                    const labelText = labels[envType] || envType;
                    const nameHtml = name ? ` <span class="env-name">${escapeHtml(name)}</span>` : "";
                    return `<div class="env env-${envType}">\n<p class="env-title"><span class="env-label">${escapeHtml(labelText)}</span>${nameHtml}</p>\n`;
                }
                return "</div>\n";
            }
        });
    }
    // 4. 锚点必须在标题 token 生成后执行。
    md.use(anchorPlugin, {
        slugify: uniqueSlug,
        callback: (token, info) => {
            tocEntries.push({
                level: Number(token.tag.slice(1)),
                id: info.slug,
                title: info.title
            });
        }
    });
    // 5. 锚点之后处理目录标题和正文标题的元数据。
    md.core.ruler.after("anchor", "mark-mto-headings", state => {
        for (const token of state.tokens) {
            if (token.type === "heading_open") token.attrSet("data-mto-heading", "1");
        }
    });    md.core.ruler.after("anchor", "render-toc-inline-titles", state => {
        for (let i = 0; i < state.tokens.length; i += 1) {
            const heading = state.tokens[i];
            if (heading.type !== "heading_open") continue;
            const entry = tocEntries.find(item => item.id === heading.attrGet("id"));
            const inline = state.tokens[i + 1];
            if (!entry || inline?.type !== "inline" || !inline.children) continue;
            entry.titleHtml = md.renderer.renderInline(inline.children, md.options, state.env).replace(/<\/?a\b[^>]*>/g, "");
        }
    });
    // 6. 第三方插件完成后，再覆盖链接和图片的最终渲染。
    const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const href = tokens[idx].attrGet("href") ?? "";
        if (/^https?:\/\//i.test(href)) {
            tokens[idx].attrSet("target", "_blank");
            tokens[idx].attrSet("rel", "noopener noreferrer");
        }
        return defaultLinkOpen(tokens, idx, options, env, self);
    };
    const defaultImage = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const src = token.attrGet("src") ?? "";
        const isRemote = /^(https?:)?\/\//i.test(src) || /^(data|mailto|file):/i.test(src);
        if (src && !isRemote) {
            const suffix = src.match(/[?#].*$/)?.[0] ?? "";
            const rawPath = suffix ? src.slice(0, -suffix.length) : src;
            let imagePath = rawPath;
            try {
                imagePath = decodeURIComponent(rawPath);
            } catch {}
            imagePath = imagePath.replaceAll("\\", path.sep);
            const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(env.chapterDir ?? baseDir, imagePath);
            token.attrSet("src", `${pathToFileURL(resolved).href}${suffix}`);
        }
        return defaultImage(tokens, idx, options, env, self);
    };
    // 7. 自定义块级规则放在最后，确保其输入 token 已由第三方插件生成。
    md.core.ruler.push("named_anchor_blocks", state => {
        const Token = state.Token;
        const tokens = state.tokens;
        for (let i = 0; i + 2 < tokens.length; i++) {
            if (tokens[i].type !== "paragraph_open" || tokens[i + 1].type !== "inline" || tokens[i + 2].type !== "paragraph_close") continue;
            const match = tokens[i + 1].content.trim().match(/^<a\s+id="([A-Za-z0-9_-]+)"><\/a>$/);
            if (!match) continue;
            const anchor = new Token("html_block", "", 0);
            anchor.content = `<a id="${match[1]}"></a>\n`;
            tokens.splice(i, 3, anchor);
        }
    });
    md.core.ruler.push("handout_figures", state => {
        const Token = state.Token;
        const tokens = state.tokens;
        for (let i = 0; i + 2 < tokens.length; i++) {
            if (tokens[i].type === "paragraph_open" && tokens[i + 1].type === "inline" && tokens[i + 2].type === "paragraph_close" && /^\\(pagebreak|newpage)$/.test(tokens[i + 1].content.trim())) {
                const marker = new Token("html_block", "", 0);
                marker.content = '<div class="hb-pagebreak" aria-hidden="true"></div>\n';
                tokens.splice(i, 3, marker);
            }
        }
        for (const blockToken of tokens) {
            if (blockToken.type !== "inline" || !blockToken.children) continue;
            for (const child of blockToken.children) {
                if (child.type !== "image") continue;
                const match = (child.content ?? "").match(/^(.*)\|\s*(\d+)(?:\s*[xX×]\s*(\d+))?\s*$/s);
                if (!match) continue;
                const cleanAlt = match[1].trim();
                child.content = cleanAlt;
                const textToken = new Token("text", "", 0);
                textToken.content = cleanAlt;
                child.children = [ textToken ];
                let style = `width: ${match[2]}px;`;
                if (match[3]) style += ` height: ${match[3]}px;`;
                child.attrSet("style", style);
            }
        }
        for (let i = 0; i + 2 < tokens.length; i++) {
            const open = tokens[i];
            const inline = tokens[i + 1];
            const close = tokens[i + 2];
            if (open.type !== "paragraph_open" || inline.type !== "inline" || close.type !== "paragraph_close") {
                continue;
            }
            const kids = (inline.children ?? []).filter(t => !(t.type === "text" && t.content.trim() === ""));
            if (kids.length !== 1 || kids[0].type !== "image") continue;
            const img = kids[0];
            open.type = "figure_open";
            open.tag = "figure";
            close.type = "figure_close";
            close.tag = "figure";
            inline.children = [ img ];
            const captionText = img.attrGet("title");
            if (captionText) {
                img.attrs = img.attrs.filter(([name]) => name !== "title");
                const capOpen = new Token("figcaption_open", "figcaption", 1);
                const capInline = new Token("inline", "", 0);
                capInline.content = captionText;
                const capText = new Token("text", "", 0);
                capText.content = captionText;
                capInline.children = [ capText ];
                const capClose = new Token("figcaption_close", "figcaption", -1);
                tokens.splice(i + 2, 0, capOpen, capInline, capClose);
                i += 3;
            }
        }
    });
    const renderRunningHeader = sectionTitle => {
        if (!withHeaderFooter) return "";
        const displayDate = formatDate(rawDate, pdfCfg.date_format);
        const values = {
            section: sectionTitle,
            title: title,
            subtitle: subtitle,
            authors: authorsText,
            author: authors[0] ?? "",
            date: displayDate,
            rawDate: rawDate,
            version: bookVersion,
            commit: gitCommit,
            lang: language,
            theme: theme.label || theme.name || ""
        };
        const renderSlot = t => String(t ?? "").replace(/\{\{(\w+)\}\}/g, (whole, key) => {
            if (key === "page" || key === "total") return "";
            return Object.hasOwn(values, key) ? escapeHtml(values[key]) : whole;
        }).trim();
        const slots = {
            left: "{{section}}",
            center: "",
            right: "",
            ...pdfCfg.header
        };
        const left = renderSlot(slots.left);
        const center = renderSlot(slots.center);
        const right = renderSlot(slots.right);
        const pageNumberAnchor = '<a class="hb-page-number-anchor" href="https://mtopb.invalid/page-number-anchor" aria-hidden="true" tabindex="-1"></a>';
        if (!left && !center && !right) return "";
        return `<div class="hb-run" aria-hidden="true"><span class="hb-run-slot hb-run-left">${left}</span><span class="hb-run-slot hb-run-center">${center}</span><span class="hb-run-slot hb-run-right">${right}${pageNumberAnchor}</span></div>`;
    };
    const wrapWithRunningHeader = (innerHtml, sectionTitle, breakBefore = false) => {
        const runningHeaderHtml = renderRunningHeader(sectionTitle);
        return runningHeaderHtml ? `<table class="hb-sheet${breakBefore ? " hb-section-break" : ""}"><thead class="hb-running"><tr><td>${runningHeaderHtml}</td></tr></thead><tbody><tr><td>\n${innerHtml}\n</td></tr></tbody></table>` : innerHtml;
    };
    const pageBreakPattern = /<div class="hb-pagebreak"[^>]*><\/div>\s*/gi;
    const wrapWithPageBreaks = (innerHtml, sectionTitle, breakBefore = false) => {
        const chunks = String(innerHtml).split(pageBreakPattern).filter(chunk => chunk.trim());
        if (chunks.length <= 1) return wrapWithRunningHeader(innerHtml, sectionTitle, breakBefore);
        return chunks.map((chunk, index) => wrapWithRunningHeader(chunk, sectionTitle, breakBefore || index > 0)).join("\n");
    };
    const wrapWithHeadingHeaders = (bodyHtml, entries, defaultTitle) => {
        const headings = Array.from(bodyHtml.matchAll(/<h1\b([^>]*)>[\s\S]*?<\/h1>/gi))
            .map(match => ({ index: match.index, attrs: match[1], id: /\bid="([^"]+)"/.exec(match[1])?.[1] }))
            .filter(match => match.id && /\bdata-mto-heading="1"/.test(match.attrs));
        if (headings.length < 2) return wrapWithPageBreaks(bodyHtml, headings.length === 1 ? entries.find(item => item.id === headings[0].id)?.title ?? defaultTitle : defaultTitle);
        const parts = [];
        headings.forEach((heading, index) => {
            const end = headings[index + 1]?.index ?? bodyHtml.length;
            const headingTitle = entries.find(item => item.id === heading.id)?.title ?? defaultTitle;
            const start = index === 0 ? 0 : heading.index;
            parts.push(wrapWithPageBreaks(bodyHtml.slice(start, end), headingTitle, index > 0));
        });
        return parts.join("\n");
    };
    const sections = [];
    let leadAssigned = false;
    const leadClass = () => {
        if (leadAssigned) return "";
        leadAssigned = true;
        return " hb-lead";
    };
    chapterEntries.forEach((entry, i) => {
        const absPath = path.resolve(baseDir, entry.file);
        if (entry.kind === "insert") {
            let fragment;
            try {
                fragment = fs.readFileSync(absPath, "utf8").replace(/^﻿/, "");
            } catch (err) {
                console.error(`ERROR: Could not read inserted file ${entry.file}: ${err.message}`);
                console.error('Run "npm run check" for details.');
                process.exit(1);
            }
            const rendered = renderTemplate(fragment, metaValues);
            const cls2 = [ "insert", entry.className ].filter(Boolean).join(" ");
            sections.push(`<section class="${cls2}${leadClass()}" data-entry="${i + 1}">\n` + wrapWithPageBreaks(rendered, title) + "\n</section>");
            return;
        }
        let source;
        try {
            source = normalizeMarkdownImagePaths(fs.readFileSync(absPath, "utf8").replace(/^﻿/, ""));
        } catch (err) {
            console.error(`ERROR: Could not read chapter file ${entry.file}: ${err.message}`);
            console.error('Run "npm run check" for details.');
            process.exit(1);
        }
        const env = {
            docId: `ch${i + 1}`,
            chapterDir: path.dirname(absPath)
        };
        const headingStart = tocEntries.length;
        let bodyHtml = normalizeRawHtmlResources(md.render(source, env), env.chapterDir);
        const wantChapterToc = entry.chapterToc === null ? chapterTocDefault : entry.chapterToc;
        if (wantChapterToc) {
            const miniToc = buildChapterToc(tocEntries.slice(headingStart));
            if (miniToc) {
                bodyHtml = /<\/h1>/.test(bodyHtml) ? bodyHtml.replace("</h1>", `</h1>\n${miniToc}`) : miniToc + bodyHtml;
            }
        }
        const runningTitle = tocEntries.slice(headingStart).find(entry2 => entry2.level === 1)?.title ?? title;
        const cls = [ "chapter", entry.className ].filter(Boolean).join(" ");
        sections.push(`<section class="${cls}${leadClass()}" data-chapter="${i + 1}">\n${wrapWithHeadingHeaders(bodyHtml, tocEntries.slice(headingStart), runningTitle)}</section>`);
    });
    const varMap = {
        accent_color: "--hb-accent",
        content_width: "--hb-content-width",
        base_font_size: "--hb-base-font-size",
        print_font_size: "--hb-print-font-size"
    };
    const rootVars = Object.entries(varMap).filter(([key]) => styleCfg[key]).map(([key, cssVar]) => `  ${cssVar}: ${sanitizeCssValue(styleCfg[key])};`);
    const paperSizes = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A5: [419.53, 595.28], LETTER: [612, 792], LEGAL: [612, 1008] };
    const paperKey = String(pdfCfg.page_size).trim().toUpperCase();
    const selectedPaper = paperSizes[paperKey];
    if (!selectedPaper) throw new Error(`Unsupported pdf.page_size in book.yml: ${paperKey}`);
    const coverFontScale = Math.min(selectedPaper[0] / paperSizes.A4[0], selectedPaper[1] / paperSizes.A4[1]);
    const scaledCoverValue = value => (value * coverFontScale).toFixed(4);
    rootVars.push(
        `  --cover-font-scale: ${coverFontScale.toFixed(6)};`,
        `  --cover-title-size: ${scaledCoverValue(77.05)}pt;`,
        `  --cover-title-line-height: ${scaledCoverValue(88.06)}pt;`,
        `  --cover-subtitle-size: ${scaledCoverValue(34.40)}pt;`,
        `  --cover-link-size: ${scaledCoverValue(23.39)}pt;`,
        `  --cover-meta-size: ${scaledCoverValue(22)}pt;`,
        `  --cover-2-title-size: ${scaledCoverValue(64)}pt;`,
        `  --cover-3-title-size: ${scaledCoverValue(72)}pt;`,
        `  --cover-3-subtitle-size: ${scaledCoverValue(48)}pt;`,
        `  --cover-4-title-size: ${scaledCoverValue(58)}pt;`,
        `  --cover-4-meta-size: ${scaledCoverValue(21)}pt;`,
        `  --cover-rule-1-width: ${scaledCoverValue(265.04)}pt;`,
        `  --cover-rule-2-width: ${scaledCoverValue(283.46)}pt;`
    );
    const fonts = styleCfg.fonts;
    if (fonts.body) rootVars.push(`  --hb-font-body: ${sanitizeCssValue(fonts.body)};`);
    if (fonts.heading) rootVars.push(`  --hb-font-heading: ${sanitizeCssValue(fonts.heading)};`);
    if (fonts.code) rootVars.push(`  --hb-font-code: ${sanitizeCssValue(fonts.code)};`);
    const hfStyleCfg = pdfCfg.header_footer_style;
    if (hfStyleCfg.font_size) rootVars.push(`  --hb-hf-font-size: ${sanitizeCssValue(hfStyleCfg.font_size)};`);
    if (hfStyleCfg.color) rootVars.push(`  --hb-hf-color: ${sanitizeCssValue(hfStyleCfg.color)};`);
    if (hfStyleCfg.font_family) rootVars.push(`  --hb-hf-font-family: ${sanitizeCssValue(hfStyleCfg.font_family)};`);
    if (/^#[0-9a-f]{6}$/i.test(String(pdfCfg.link_annotation_color))) rootVars.push(`  --hb-link-text-color: ${pdfCfg.link_annotation_color};`);
    rootVars.push(
        `  --hb-image-pagination: ${sanitizeCssValue(pdfCfg.image_pagination)};`,
        `  --hb-code-block-pagination: ${sanitizeCssValue(pdfCfg.code_block_pagination)};`,
        `  --hb-table-pagination: ${sanitizeCssValue(pdfCfg.table_pagination)};`
    );
    if (coverCfg.background) rootVars.push(`  --hb-cover-bg: ${sanitizeCssValue(coverCfg.background)};`);
    if (coverCfg.color) rootVars.push(`  --hb-cover-color: ${sanitizeCssValue(coverCfg.color)};`);
    if (backCfg.background) rootVars.push(`  --hb-back-bg: ${sanitizeCssValue(backCfg.background)};`);
    if (backCfg.color) rootVars.push(`  --hb-back-color: ${sanitizeCssValue(backCfg.color)};`);
    const m = marginParts(sanitizeCssValue(pdfCfg.margin));
    rootVars.push(`  --hb-page-margin-top: ${m.top};`);
    rootVars.push(`  --hb-page-margin-right: ${m.right};`);
    rootVars.push(`  --hb-page-margin-bottom: ${m.bottom};`);
    rootVars.push(`  --hb-page-margin-left: ${m.left};`);
    if (coverUsesHeaderFooter) {
        rootVars.push("  --hb-cover-pad-top: 60mm;");
    }
    let overrideCss = "";
    if (rootVars.length > 0) {
        overrideCss += `:root {\n${rootVars.join("\n")}\n}\n`;
    }
    const pageRules = [];
    pageRules.push(`size: ${sanitizeCssValue(pdfCfg.page_size)};`);
    pageRules.push(`margin: ${sanitizeCssValue(pdfCfg.margin)};`);
    if (pageRules.length > 0) {
        overrideCss += `@page {\n  ${pageRules.join("\n  ")}\n}\n`;
    }
    if (!coverEnabled || coverUsesHeaderFooter) {
        overrideCss += `@page :first {\n  margin: ${sanitizeCssValue(pdfCfg.margin)};\n}\n`;
    }
    const customList = Array.isArray(styleCfg.custom_css) ? styleCfg.custom_css : styleCfg.custom_css ? [ styleCfg.custom_css ] : [];
    const customCss = customList.map(file => {
        const customCssPath = resolveProjectOrToolFile(file);
        if (!fs.existsSync(customCssPath)) {
            console.error(`ERROR: style.custom_css file not found: ${file}`);
            process.exit(1);
        }
        return fs.readFileSync(customCssPath, "utf8").replace(/url\((['"]?)((?:\.\.\/)+fonts\/[^)'\"]+)\1\)/g, (_whole, _quote, url) => {
            const fontPath = path.resolve(path.dirname(customCssPath), url);
            return `url("${pathToFileURL(fontPath).href}")`;
        });
    }).join("\n");
    const inlineCss = `${katexCss}\n${printCss}` + (overrideCss ? `\n${overrideCss}` : "") + (customCss ? `\n${customCss}` : "");
    const coverLayoutClass = coverCfg.layout ? ` cover-layout-${sanitizeCssValue(coverCfg.layout)}` : "";
    const coverHtml = coverEnabled ? `<header id="cover" class="cover${coverLayoutClass}">\n` + (coverCfg.html ? loadComponent(coverCfg.html, "cover.html") : renderTemplate(DEFAULT_COVER, metaValues)) + "\n</header>" : "";
    const backCoverHtml = backEnabled ? '<footer id="back-cover" class="back-cover">\n' + (backCfg.html ? loadComponent(backCfg.html, "back_cover.html") : renderTemplate(DEFAULT_BACK_COVER, metaValues)) + "\n</footer>" : "";
    const docTitle = theme.isDefault ? title : `${title} · ${theme.label || theme.name}`;
    const tocRaw = buildToc(tocEntries);
    const tocHtml = tocRaw ? tocRaw.replace(/^(<nav class="toc" id="toc">\n)([\s\S]*)(\n<\/nav>)$/, (whole, open, inner, close) => open + wrapWithRunningHeader(inner, tocTitle) + close) : "";
    const handoutHtml = renderTemplate(documentTemplate, {
        ...metaValues,
        docTitle: escapeHtml(docTitle),
        cover: coverHtml,
        toc: tocHtml,
        backCover: backCoverHtml,
        css: inlineCss,
        body: sections.join("\n\n")
    });
    fs.mkdirSync(path.dirname(htmlOutTheme), {
        recursive: true
    });
    fs.writeFileSync(htmlOutTheme, handoutHtml);
    console.log(`Generated ${toPosix(path.relative(process.cwd(), htmlOutTheme))}`);
    return {
        theme: theme,
        htmlOutTheme: htmlOutTheme,
        pdfOutTheme: pdfOutTheme,
        styleCfg: styleCfg,
        fonts: fonts,
        tocEntries: tocEntries
    };
}

for (const theme of themes) buildTheme(theme);

const notesAssets = path.join(notesDir, "assets");

if (fs.existsSync(notesAssets)) {
    fs.cpSync(notesAssets, path.join(distDir, "assets"), {
        recursive: true
    });
}

const thirdPartyNotices = path.join(toolRoot, "THIRD_PARTY_NOTICES.md");

if (fs.existsSync(thirdPartyNotices)) {
    fs.copyFileSync(thirdPartyNotices, path.join(distDir, "THIRD_PARTY_NOTICES.md"));
}

