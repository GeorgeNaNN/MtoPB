import fs from "node:fs";

import path from "node:path";

import YAML from "yaml";

const MD_EXTS = new Set([ ".md", ".markdown" ]);

const HTML_EXTS = new Set([ ".html", ".htm" ]);

const CHAPTERS_FILE_EXTS = new Set([ ".yml", ".yaml" ]);

const CLASS_TOKENS_RE = /^[A-Za-z_-][\w-]*(?:\s+[A-Za-z_-][\w-]*)*$/;

function isValidClassAttr(value) {
    return CLASS_TOKENS_RE.test(String(value).trim());
}

function classifyChapterPath(p) {
    const ext = path.extname(String(p)).toLowerCase();
    if (MD_EXTS.has(ext)) return "chapter";
    if (HTML_EXTS.has(ext)) return "insert";
    return null;
}

function resolveChapterList(book, baseDir) {
    const raw = book?.chapters;
    if (typeof raw === "string") {
        const ref = raw.trim();
        const ext = path.extname(ref).toLowerCase();
        if (!CHAPTERS_FILE_EXTS.has(ext)) {
            return {
                error: `When chapters is a string, it must point to a .yml or .yaml file (received: "${ref}"). Use a list for inline chapter entries.`
            };
        }
        const filePath = path.resolve(baseDir, ref);
        if (!fs.existsSync(filePath)) {
            return {
                error: `Chapter list file not found: ${ref}`
            };
        }
        let doc;
        try {
            doc = YAML.parse(fs.readFileSync(filePath, "utf8"));
        } catch (err) {
            return {
                error: `Unable to parse chapter list file ${ref}: ${err.message}`
            };
        }
        const list = Array.isArray(doc) ? doc : doc?.chapters;
        if (!Array.isArray(list)) {
            return {
                error: `Chapter list file ${ref} must be a YAML list or a mapping that contains a chapters list.`
            };
        }
        return {
            list: list,
            source: ref
        };
    }
    if (Array.isArray(raw)) return {
        list: raw,
        source: null
    };
    return {
        error: `chapters must be a non-empty list of file paths or a path to a .yml/.yaml chapter list file.`
    };
}

function normalizeChapterEntry(entry) {
    if (typeof entry === "string") {
        const file = entry.trim();
        if (!file) return {
            error: `Chapter entry is empty.`
        };
        const kind = classifyChapterPath(file);
        if (!kind) {
            return {
                error: `Unrecognized file extension: ${JSON.stringify(file)} (use .md/.markdown or .html/.htm).`
            };
        }
        return {
            kind: kind,
            file: file,
            className: "",
            chapterToc: null
        };
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        if (entry.path === void 0 || entry.path === null || String(entry.path).trim() === "") {
            return {
                error: `Chapter object is missing path: ${JSON.stringify(entry)}`
            };
        }
        const file = String(entry.path).trim();
        const kind = classifyChapterPath(file);
        if (!kind) {
            return {
                error: `Unrecognized file extension: ${JSON.stringify(file)} (use .md/.markdown or .html/.htm).`
            };
        }
        let className = "";
        if (entry.class !== void 0 && entry.class !== null) {
            className = String(entry.class).trim();
        }
        let chapterToc = null;
        if (entry.chapter_toc !== void 0 && entry.chapter_toc !== null) {
            chapterToc = Boolean(entry.chapter_toc);
        }
        return {
            kind: kind,
            file: file,
            className: className,
            chapterToc: chapterToc
        };
    }
    return {
        error: `Invalid chapter entry: ${JSON.stringify(entry)}`
    };
}

function normalizeChapters(book, baseDir) {
    const resolved = resolveChapterList(book, baseDir);
    if (resolved.error) return {
        error: resolved.error
    };
    if (!resolved.list || resolved.list.length === 0) {
        return {
            error: `chapters cannot be empty.`
        };
    }
    const entries = [];
    for (const raw of resolved.list) {
        const d = normalizeChapterEntry(raw);
        if (d.error) return {
            error: d.error
        };
        entries.push(d);
    }
    return {
        entries: entries,
        source: resolved.source
    };
}

export { classifyChapterPath, isValidClassAttr, normalizeChapterEntry, normalizeChapters, resolveChapterList };
