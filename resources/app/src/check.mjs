import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

import YAML from "yaml";

import { resolveChapterList, normalizeChapterEntry, isValidClassAttr } from "./lib/chapters.mjs";

import { normalizeMarkdownImagePaths } from "./lib/markdown-images.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const toolRoot = path.resolve(scriptDir, "..");

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

const configName = path.basename(configPath);

const errors = [];

const warnings = [];

const fail = message => errors.push(message);

const toPosix = p => p.split(path.sep).join("/");

const referencedImages = new Set;

if (!fs.existsSync(configPath)) {
    console.error(`ERROR: Configuration file not found: ${configPath}`);
    process.exit(1);
}

let book;

try {
    book = YAML.parse(fs.readFileSync(configPath, "utf8"));
} catch (err) {
    console.error(`ERROR: Could not parse ${configName}: ${err.message}`);
    process.exit(1);
}

if (!book || typeof book !== "object") {
    console.error(`ERROR: ${configName} is empty or is not a valid YAML mapping.`);
    process.exit(1);
}

const chaptersResult = resolveChapterList(book, baseDir);

if (chaptersResult.error) {
    console.error(`ERROR: ${chaptersResult.error}`);
    process.exit(1);
}

const rawChapters = chaptersResult.list;

if (rawChapters.length === 0) {
    console.error(`ERROR: chapters in ${configName} cannot be empty.`);
    process.exit(1);
}

const IMAGE_RE = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)>\s]+))[^)]*\)/g;

const HTML_IMAGE_RE = /<img\b[^>]*\bsrc\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;

function isRemoteTarget(target) {
    return /^(https?:)?\/\//i.test(target) || /^(data|mailto|ftp|file|blob):/i.test(target);
}

function checkImageTarget(rawTarget, absPath, relPath, lineNo) {
    if (!rawTarget || isRemoteTarget(rawTarget)) return;
    let target = rawTarget.split("#")[0].split("?")[0];
    if (!target) return;
    try {
        target = decodeURIComponent(target);
    } catch {}
    const resolved = path.resolve(path.dirname(absPath), target);
    if (!fs.existsSync(resolved)) {
        fail(`${relPath}:${lineNo}: Image not found: ${rawTarget} (resolved to ${toPosix(path.relative(baseDir, resolved))})`);
    } else {
        referencedImages.add(resolved);
    }
}

function checkChapterContent(absPath, relPath) {
    const text = normalizeMarkdownImagePaths(fs.readFileSync(absPath, "utf8").replace(/^﻿/, ""));
    const lines = text.split(/\r?\n/);
    let inFence = false;
    let rawCodeTag = "";
    let fenceChar = "";
    let fenceLength = 0;
    lines.forEach((rawLine, idx) => {
        const lineNo = idx + 1;
        if (rawCodeTag) {
            if (new RegExp(`</${rawCodeTag}\\s*>`, "i").test(rawLine)) rawCodeTag = "";
            return;
        }
        const rawCodeOpen = rawLine.match(/<(script|style)\b[^>]*>/i);
        if (rawCodeOpen) {
            const tag = rawCodeOpen[1].toLowerCase();
            const remainder = rawLine.slice(rawCodeOpen.index + rawCodeOpen[0].length);
            if (!new RegExp(`</${tag}\\s*>`, "i").test(remainder)) rawCodeTag = tag;
            return;
        }
        const fenceMatch = rawLine.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            const char = fenceMatch[1][0];
            if (!inFence) {
                inFence = true;
                fenceChar = char;
                fenceLength = fenceMatch[1].length;
            } else if (char === fenceChar && fenceMatch[1].length >= fenceLength && !fenceMatch[2].trim()) {
                inFence = false;
            }
            return;
        }
        if (inFence) return;
        const line = rawLine.replace(/(`+).*?\1/g, "");
        for (const match of line.matchAll(IMAGE_RE)) checkImageTarget(match[1] ?? match[2], absPath, relPath, lineNo);
        for (const match of line.matchAll(HTML_IMAGE_RE)) checkImageTarget(match[2] ?? match[3], absPath, relPath, lineNo);
    });
}

const seenChapters = new Set;

const chapterResolvedPaths = [];

for (const raw of rawChapters) {
    const entry = normalizeChapterEntry(raw);
    if (entry.error) {
        fail(`${configName}: ${entry.error}`);
        continue;
    }
    const absPath = path.resolve(baseDir, entry.file);
    if (seenChapters.has(absPath)) {
        fail(`${configName}: Chapter file is listed more than once: ${entry.file}`);
        continue;
    }
    seenChapters.add(absPath);
    chapterResolvedPaths.push(absPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        const kind = entry.kind === "insert" ? "insert file" : "chapter file";
        fail(`${configName}: ${kind} not found: ${entry.file}`);
        continue;
    }
    if (entry.className && !isValidClassAttr(entry.className)) {
        fail(`${configName}: Invalid class name for ${entry.file}: ${JSON.stringify(entry.className)}. Use space-separated names matching [A-Za-z_-][A-Za-z0-9_-]*.`);
    }
    if (entry.kind === "insert" && entry.chapterToc !== null) {
        warnings.push(`${entry.file}: Chapter TOC settings are ignored for inserted .html pages.`);
    }
    if (entry.kind === "chapter") {
        checkChapterContent(absPath, toPosix(entry.file));
    }
}

if (book.themes !== void 0) {
    if (!Array.isArray(book.themes) || book.themes.length === 0) {
        fail(`${configName}: themes must be a non-empty array or removed entirely.`);
    } else {
        const seenNames = new Set;
        let defaultCount = 0;
        book.themes.forEach((theme, i) => {
            const label = `themes[${i}]`;
            if (!theme || typeof theme !== "object") {
                fail(`${configName}: ${label} must be a mapping that includes at least name.`);
                return;
            }
            const name = theme.name;
            if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
                fail(`${configName}: ${label}.name must match [A-Za-z0-9][A-Za-z0-9_-]* (used in output filenames); received ${JSON.stringify(name)}.`);
            } else if (seenNames.has(name)) {
                fail(`${configName}: Duplicate theme name: "${name}".`);
            } else {
                seenNames.add(name);
            }
            if (theme.default === true) defaultCount += 1;
        });
        if (defaultCount > 1) {
            fail(`${configName}: Only one theme may set default: true; found ${defaultCount}.`);
        }
    }
}

function checkReferencedFiles(scope, where) {
    if (!scope || typeof scope !== "object") return;
    const cssRaw = scope.style?.custom_css;
    const cssList = Array.isArray(cssRaw) ? cssRaw : cssRaw ? [ cssRaw ] : [];
    for (const file of cssList) {
        const projectPath = path.resolve(baseDir, String(file));
        const toolPath = path.resolve(toolRoot, String(file));
        if (!fs.existsSync(projectPath) && !fs.existsSync(toolPath)) {
            fail(`${configName}: Custom stylesheet not found at ${where}${file}.`);
        }
    }
    for (const [section, key] of [ [ "cover", "cover" ], [ "back_cover", "back_cover" ] ]) {
        const html = scope[section]?.html;
        if (html && !fs.existsSync(path.resolve(baseDir, String(html)))) {
            fail(`${configName}: ${key}.html component not found at ${where}${html}.`);
        }
    }
}

checkReferencedFiles(book, "");

if (Array.isArray(book.themes)) {
    book.themes.forEach((theme, i) => checkReferencedFiles(theme, `themes[${i}].`));
}

const KNOWN_PLACEHOLDERS = new Set([ "page", "total", "section", "title", "subtitle", "authors", "author", "date", "rawDate", "version", "commit", "lang", "theme" ]);

const KNOWN_HF_STYLE_KEYS = new Set([ "font_size", "color", "font_family", "offset" ]);

if (book.date_format !== void 0 && typeof book.date_format !== "string") {
    fail(`${configName}: date_format must be text, for example "YYYY-MM-DD".`);
}

if (book.version !== void 0 && book.version !== null && ![ "string", "number" ].includes(typeof book.version)) {
    fail(`${configName}: version must be text or a number, for example "v2" or "Rev. B".`);
}

function checkPdfConfig(scope, where) {
    const pdf = scope?.pdf;
    if (pdf === void 0) return;
    if (!pdf || typeof pdf !== "object") {
        fail(`${configName}: ${where}pdf must be a mapping.`);
        return;
    }
    if (pdf.date_format !== void 0 && typeof pdf.date_format !== "string") {
        fail(`${configName}: ${where}pdf.date_format must be text.`);
    }
    if (pdf.link_annotation_color !== void 0 && !/^#[0-9a-f]{6}$/i.test(String(pdf.link_annotation_color))) {
        fail(`${configName}: ${where}pdf.link_annotation_color must be a 6-digit hexadecimal color.`);
    }
    const pn = pdf.page_numbers;
    if (pn !== void 0) {
        if (!pn || typeof pn !== "object") {
            fail(`${configName}: ${where}pdf.page_numbers must be a mapping.`);
        } else {
            if (pn.format !== void 0 && typeof pn.format !== "string") {
                fail(`${configName}: ${where}pdf.page_numbers.format must be text.`);
            }
            for (const key of [ "count_cover", "count_toc", "count_back_cover" ]) {
                if (pn[key] !== void 0 && typeof pn[key] !== "boolean") {
                    fail(`${configName}: ${where}pdf.page_numbers.${key} must be true or false.`);
                }
            }
            if (typeof pn.format === "string") {
                for (const m of pn.format.matchAll(/\{\{(\w+)\}\}/g)) {
                    if (!KNOWN_PLACEHOLDERS.has(m[1])) {
                        warnings.push(`${where}pdf.page_numbers.format: Unknown placeholder {{${m[1]}}}; it will be kept as literal text.`);
                    }
                }
            }
        }
    }
    for (const section of [ "header", "footer" ]) {
        const slots = pdf[section];
        if (slots === void 0) continue;
        if (!slots || typeof slots !== "object") {
            fail(`${configName}: ${where}pdf.${section} must be a mapping containing left, center, and right.`);
            continue;
        }
        for (const [slot, value] of Object.entries(slots)) {
            if (![ "left", "center", "right" ].includes(slot)) {
                warnings.push(`${where}pdf.${section}.${slot}: Unknown position; use left, center, or right.`);
                continue;
            }
            if (typeof value !== "string") {
                fail(`${configName}: ${where}pdf.${section}.${slot} must be text.`);
                continue;
            }
            for (const m of value.matchAll(/\{\{(\w+)\}\}/g)) {
                if (!KNOWN_PLACEHOLDERS.has(m[1])) {
                    warnings.push(`${where}pdf.${section}.${slot}: Unknown placeholder {{${m[1]}}}; it will be kept as literal text.`);
                }
            }
        }
    }
    const hfs = pdf.header_footer_style;
    if (hfs !== void 0) {
        if (!hfs || typeof hfs !== "object") {
            fail(`${configName}: ${where}pdf.header_footer_style must be a mapping.`);
        } else {
            for (const key of Object.keys(hfs)) {
                if (!KNOWN_HF_STYLE_KEYS.has(key)) {
                    warnings.push(`${where}pdf.header_footer_style.${key}: Unknown setting; ignored.`);
                }
            }
        }
    }
}

checkPdfConfig(book, "");

if (Array.isArray(book.themes)) {
    book.themes.forEach((theme, i) => checkPdfConfig(theme, `themes[${i}].`));
}

const BUILTIN_LABEL_KEYS = new Set([ "note", "tip", "warning", "danger", "theorem", "definition", "example", "exercise" ]);

if (book.labels !== void 0) {
    if (!book.labels || typeof book.labels !== "object" || Array.isArray(book.labels)) {
        fail(`${configName}: labels must be a mapping, for example labels: { note: "Note" }.`);
    } else {
        for (const [key, value] of Object.entries(book.labels)) {
            if (typeof value !== "string") {
                fail(`${configName}: labels.${key} must be text.`);
                continue;
            }
            if (!BUILTIN_LABEL_KEYS.has(key)) {
                if (key === "pagebreak") {
                    fail(`${configName}: labels.pagebreak is reserved and cannot be used as a custom container.`);
                } else if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
                    fail(`${configName}: Custom container name labels.${key} must match [A-Za-z][A-Za-z0-9_-]* (used for ::: containers and CSS classes).`);
                }
            }
        }
    }
}

if (book.chapter_toc !== void 0) {
    const ct = book.chapter_toc;
    if (!ct || typeof ct !== "object" || Array.isArray(ct)) {
        fail(`${configName}: chapter_toc must be a mapping (default / title / depth / class).`);
    } else {
        if (ct.default !== void 0 && typeof ct.default !== "boolean") {
            fail(`${configName}: chapter_toc.default must be true or false.`);
        }
        if (ct.title !== void 0 && ct.title !== null && ![ "string", "number" ].includes(typeof ct.title)) {
            fail(`${configName}: chapter_toc.title must be text.`);
        }
        if (ct.depth !== void 0 && (typeof ct.depth !== "number" || !Number.isInteger(ct.depth) || ct.depth < 2 || ct.depth > 6)) {
            fail(`${configName}: chapter_toc.depth must be an integer from 2 to 6.`);
        }
        if (ct.class !== void 0 && ct.class !== null && ct.class !== "" && !isValidClassAttr(ct.class)) {
            fail(`${configName}: chapter_toc.class must contain space-separated CSS classes matching [A-Za-z_-][A-Za-z0-9_-]*.`);
        }
    }
}

if (book.numbering !== void 0) {
    warnings.push("numbering: This setting has been removed. Add numbering directly to headings, environment names, figure captions, or KaTeX \\tag{...}.");
}

function* walkFiles(dir) {
    for (const entry of fs.readdirSync(dir, {
        withFileTypes: true
    })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walkFiles(full); else if (entry.isFile()) yield full;
    }
}

const chapterSet = new Set(chapterResolvedPaths);

const notesDir = path.join(baseDir, "notes");

const assetsDir = path.join(notesDir, "assets");

if (fs.existsSync(notesDir)) {
    for (const file of walkFiles(notesDir)) {
        if (!file.endsWith(".md")) continue;
        if (path.basename(file).startsWith("_")) continue;
        if (!chapterSet.has(file)) {
            warnings.push(`${toPosix(path.relative(baseDir, file))}: not listed in ${configName} "chapters" — it will NOT appear in the handout (prefix the filename with "_" to mark it as a draft)`);
        }
    }
}

if (fs.existsSync(assetsDir)) {
    for (const file of walkFiles(assetsDir)) {
        if (!referencedImages.has(file)) {
            warnings.push(`${toPosix(path.relative(baseDir, file))}: not referenced by any chapter (unused asset)`);
        }
    }
}

if (warnings.length > 0) {
        console.warn(`${warnings.length} warning(s):\n`);
    for (const message of warnings) {
        console.warn(`  ⚠ ${message}`);
    }
    console.warn("");
}

if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):\n`);
    for (const message of errors) {
        console.error(`  ✗ ${message}`);
    }
    process.exit(1);
}

console.log("Validation passed");
