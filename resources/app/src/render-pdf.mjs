import fs from "node:fs";

import http from "node:http";

import path from "node:path";

import zlib from "node:zlib";

import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import YAML from "yaml";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pdfRuntime = path.join(toolRoot, "pdf-runtime", "win-x64", "chrome-headless-shell.exe");

const cdpEndpoint = process.env.MTOPB_CDP_ENDPOINT;

const printEndpoint = process.env.MTOPB_PRINT_ENDPOINT;

const printToken = process.env.MTOPB_PRINT_TOKEN;

const cdpPagesInUse = new Set;

const toPosix = p => p.split(path.sep).join("/");

const rel = p => toPosix(path.relative(process.cwd(), p));

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

if (!book || typeof book !== "object") throw new Error("book.yml must contain a configuration object.");
for (const key of ["output", "metadata", "pdf", "cover", "back_cover", "style"]) {
    if (!book[key] || typeof book[key] !== "object") throw new Error(`book.yml is missing the ${key} configuration group.`);
}
for (const key of ["html", "pdf"]) {
    if (typeof book.output[key] !== "string" || !book.output[key]) throw new Error(`book.yml is missing output.${key}.`);
}
for (const key of ["title", "author", "subject", "keywords"]) {
    if (book.metadata[key] === undefined || book.metadata[key] === null) throw new Error(`book.yml is missing metadata.${key}.`);
    if (typeof book.metadata[key] !== "string" && !Array.isArray(book.metadata[key])) throw new Error(`Invalid metadata.${key} format in book.yml.`);
}
if (!Array.isArray(book.themes) || book.themes.length === 0) throw new Error("book.yml is missing the themes setting.");
if (!book.pdf.page_numbers || typeof book.pdf.page_numbers !== "object") throw new Error("book.yml is missing pdf.page_numbers.");
if (typeof book.pdf.margin !== "string" || !book.pdf.margin.trim()) throw new Error("book.yml is missing pdf.margin.");
if (!book.pdf.header_footer_style || typeof book.pdf.header_footer_style !== "object") throw new Error("book.yml is missing pdf.header_footer_style.");
for (const key of ["header_footer", "toc_page_numbers", "cover_header_footer"]) {
    if (typeof book.pdf[key] !== "boolean") throw new Error(`book.yml is missing pdf.${key}.`);
}
for (const key of ["count_cover", "count_toc", "count_back_cover", "show_cover"]) {
    if (typeof book.pdf.page_numbers[key] !== "boolean") throw new Error(`book.yml is missing pdf.page_numbers.${key}.`);
}
if (typeof book.cover.enabled !== "boolean" || typeof book.back_cover.enabled !== "boolean") {
    throw new Error("book.yml is missing cover.enabled or back_cover.enabled.");
}
if (typeof book.version !== "string" || !book.version.trim()) throw new Error("book.yml is missing version.");
if (typeof book.language !== "string" || !book.language.trim()) throw new Error("book.yml is missing language.");

const htmlOut = path.resolve(baseDir, book.output.html);

const pdfOut = path.resolve(baseDir, book.output.pdf);

const bookVersion = book.version.trim().replace(/^v/i, "");

const language = book.language;

const rawDate = book?.date ? String(book.date) : "";
const metadataTitle = String(book.metadata.title);
const metadataAuthor = String(book.metadata.author);
const metadataSubject = String(book.metadata.subject);
const metadataKeywords = Array.isArray(book.metadata.keywords) ? book.metadata.keywords.map(String) : String(book.metadata.keywords).split(/[,，\r\n]+/).map(item => item.trim()).filter(Boolean);

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

function marginParts(value) {
    const parts = value.trim().split(/\s+/);
    if (parts.length < 1 || parts.length > 4) throw new Error("pdf.margin must contain 1 to 4 valid margin values.");
    const [a, b = a, c = a, d = b] = parts;
    return {
        top: a,
        right: b,
        bottom: c,
        left: d
    };
}

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

function cssLengthToMm(value) {
    const m = String(value ?? "").trim().match(/^([\d.]+)\s*(mm|cm|in|pt|px)?$/i);
    if (!m) return null;
    const n = Number.parseFloat(m[1]);
    const per = {
        mm: 1,
        cm: 10,
        in: 25.4,
        pt: 25.4 / 72,
        px: 25.4 / 96
    };
    return n * (per[(m[2] ?? "mm").toLowerCase()] ?? 1);
}

const TOC_PAGE_MARKER_PREFIX = "https://mtopb.invalid/toc-page/";

const PAGE_NUMBER_ANCHOR_URL = "https://mtopb.invalid/page-number-anchor";

let pdfJsModulePromise;
function importPdfJs() {
    if (!pdfJsModulePromise) {
        pdfJsModulePromise = (async () => {
            const originalWarn = console.warn;
            console.warn = (...args) => {
                const message = args.map(value => String(value)).join(" ");
                if (/Cannot load "@napi-rs\/canvas"/.test(message) || /Cannot polyfill `(?:DOMMatrix|Path2D)`/.test(message)) return;
                originalWarn(...args);
            };
            try {
                return await import("pdfjs-dist/legacy/build/pdf.mjs");
            } finally {
                console.warn = originalWarn;
            }
        })();
    }
    return pdfJsModulePromise;
}

async function resolvePageNumberAnchors(pdfBuffer) {
    let getDocument;
    try {
        ({getDocument: getDocument} = await importPdfJs());
    } catch (err) {
        console.warn(`WARNING: Could not load pdfjs-dist page layout support (${err.message}); using fallback positioning.`);
        return [];
    }
    const loadingTask = getDocument({
        data: new Uint8Array(pdfBuffer),
        useSystemFonts: true,
        isEvalSupported: false,
        verbosity: 0
    });
    const doc = await loadingTask.promise;
    const anchors = [];
    try {
        for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex += 1) {
            const pdfPage = await doc.getPage(pageIndex + 1);
            const annotations = await pdfPage.getAnnotations({intent: "display"});
            const anchor = annotations.find(annotation => annotation.subtype === "Link" && annotation.url === PAGE_NUMBER_ANCHOR_URL);
            if (anchor) {
                const textContent = await pdfPage.getTextContent();
                const marker = textContent.items.find(item => item.str?.includes("00000") && item.transform?.[4] >= anchor.rect[0] - 1 && item.transform?.[4] <= anchor.rect[2] + 1);
                anchors.push({
                    pageIndex: pageIndex,
                    rect: [...anchor.rect],
                    baseline: marker?.transform?.[5],
                    size: marker?.height
                });
            }
            pdfPage.cleanup();
        }
    } finally {
        await loadingTask.destroy();
    }
    return anchors;
}

async function resolveTocPageNumbers(pdfBuffer, page, {hasCover, hasToc, hasBack, countCover, countToc, countBack}) {
    let getDocument;
    try {
        ({getDocument: getDocument} = await importPdfJs());
    } catch (err) {
        console.warn(`WARNING: Could not load pdfjs-dist (${err.message}); TOC page number processing will be skipped.`);
        return null;
    }
    const loadingTask = getDocument({
        data: new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength),
        useSystemFonts: true,
        isEvalSupported: false,
        verbosity: 0
    });
    const doc = await loadingTask.promise;
    try {
        const tocEntries = await page.evaluate(() => Array.from(document.querySelectorAll("#toc .toc-page[data-target]")).map(target => {
            const id = target.dataset.target || "";
            const heading = document.getElementById(id);
            const link = target.parentElement?.querySelector(".toc-title a");
            const leaderStyle = getComputedStyle(target.parentElement.querySelector(".toc-leader-dots"));
            return {
                id: id,
                title: (link?.innerText || heading?.innerText || id).trim(),
                level: Number(heading?.tagName.slice(1)) || 1,
                markerWidth: target.getBoundingClientRect().width,
                fontSize: Number.parseFloat(getComputedStyle(target).fontSize),
                leaderFontSize: Number.parseFloat(leaderStyle.fontSize),
                leaderSpacing: Number.parseFloat(leaderStyle.letterSpacing) || 0,
                leaderGap: Number.parseFloat(getComputedStyle(target.parentElement).columnGap) || 0
            };
        }));
        const targetIndexById = new Map(tocEntries.map((entry, index) => [entry.id, index]));
        const pageIndexByTarget = new Map;
        const tocLinkPositions = new Map;
        const pageCount = doc.numPages;
        const tocStartPage = hasCover ? 1 : 0;
        const tocMarkers = [];
        const seenMarkers = new Set;
        let markerCount = 0;
        let tocPageCount = 0;
        for (let pageIndex = tocStartPage; pageIndex < pageCount && markerCount < tocEntries.length; pageIndex += 1) {
            const pdfPage = await doc.getPage(pageIndex + 1);
            let pageMarkerCount = 0;
            const annotations = await pdfPage.getAnnotations({intent: "display"});
            for (const annotation of annotations) {
                if (annotation.subtype !== "Link") continue;
                if (annotation.url?.startsWith(TOC_PAGE_MARKER_PREFIX)) {
                    const markerIndex = Number(annotation.url.slice(TOC_PAGE_MARKER_PREFIX.length));
                    const entry = tocEntries[markerIndex];
                    if (!Number.isInteger(markerIndex) || !entry) continue;
                    const [left, bottom, right, top] = annotation.rect;
                    const scale = (right - left) / entry.markerWidth;
                    const fontSize = entry.fontSize * scale;
                    tocMarkers[markerIndex] = {
                        pageIndex: pageIndex,
                        annotationPageIndex: pageIndex,
                        rightX: right,
                        y: bottom,
                        height: top - bottom,
                        fontSize: fontSize,
                        leaderFontSize: entry.leaderFontSize * scale,
                        leaderSpacing: entry.leaderSpacing * scale,
                        leaderGap: entry.leaderGap * scale
                    };
                    if (!seenMarkers.has(markerIndex)) {
                        seenMarkers.add(markerIndex);
                        markerCount += 1;
                        pageMarkerCount += 1;
                    }
                    continue;
                }
                if (!annotation.dest) continue;
                let targetId = "";
                if (typeof annotation.dest === "string") {
                    try {
                        targetId = decodeURIComponent(annotation.dest);
                    } catch {
                        targetId = annotation.dest;
                    }
                }
                const targetIndex = targetIndexById.get(targetId);
                if (targetIndex === undefined) continue;
                if (!tocLinkPositions.has(targetIndex)) {
                    tocLinkPositions.set(targetIndex, {
                        pageIndex: pageIndex,
                        rect: [...annotation.rect]
                    });
                } else if (tocLinkPositions.get(targetIndex).pageIndex === pageIndex) {
                    const position = tocLinkPositions.get(targetIndex);
                    position.rect[2] = Math.max(position.rect[2], annotation.rect[2]);
                }
                if (pageIndexByTarget.has(targetIndex)) continue;
                const destination = Array.isArray(annotation.dest) ? annotation.dest : await doc.getDestination(annotation.dest);
                if (!Array.isArray(destination) || !destination[0]) continue;
                try {
                    pageIndexByTarget.set(targetIndex, await doc.getPageIndex(destination[0]));
                } catch {}
            }
            if (pageMarkerCount) tocPageCount += 1;
            pdfPage.cleanup();
            if (!pageMarkerCount) break;
        }
        const firstMainEntry = tocEntries.findIndex(entry => entry.level === 1);
        const mainStartPage = firstMainEntry >= 0 ? (pageIndexByTarget.get(firstMainEntry) ?? tocStartPage + tocPageCount) : tocStartPage + tocPageCount;
        const pageLabel = pageIndex => {
            if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) return null;
            if (hasCover && pageIndex === 0 && !countCover) return null;
            if (hasToc && !countToc && pageIndex >= tocStartPage && pageIndex < mainStartPage) return null;
            if (hasBack && pageIndex === pageCount - 1 && !countBack) return null;
            let label = pageIndex + 1;
            if (hasCover && !countCover && pageIndex > 0) label -= 1;
            if (hasToc && !countToc && pageIndex >= mainStartPage) label -= tocPageCount;
            return String(label);
        };
        const tocNumbers = tocEntries.map((_entry, index) => pageLabel(pageIndexByTarget.get(index)));
        for (let index = 0; index < tocEntries.length; index += 1) {
            const marker = tocMarkers[index];
            const position = tocLinkPositions.get(index);
            if (!marker || !position) continue;
            marker.pageIndex = position.pageIndex;
            marker.height = marker.fontSize;
            marker.y = position.rect[1] + 2.5 - marker.height;
            marker.leaderStartX = position.rect[2] + marker.leaderGap;
        }
        const tocBookmarks = tocEntries.flatMap((entry, index) => {
            const pageIndex = pageIndexByTarget.get(index);
            return Number.isInteger(pageIndex) ? [{...entry, pageIndex}] : [];
        });
        return {
            pageCount: pageCount,
            tocNumbers: tocNumbers,
            tocMarkers: tocMarkers,
            tocBookmarks: tocBookmarks,
            tocStartPage: tocStartPage,
            tocPageCount: tocPageCount,
            mainStartPage: mainStartPage
        };
    } finally {
        await loadingTask.destroy();
    }
}

async function createFontSubset(fontPath, texts) {
    const {createFont: createFont} = await import("fonteditor-core");
    const codepoints = [ ...new Set(Array.from(texts.join(""), char => char.codePointAt(0))) ];
    if (codepoints.length === 0) return null;
    const source = fs.readFileSync(fontPath);
    const font = createFont(source, {
        type: "ttf",
        subset: codepoints,
        hinting: false,
        kerning: true
    });
    return Buffer.from(font.write({
        type: "ttf",
        hinting: false,
        kerning: true
    }));
}

function addPdfBookmarks(doc, entries, {PDFName, PDFHexString, PDFNull}) {
    const roots = [];
    const stack = [];
    for (const entry of entries) {
        while (stack.length && stack.at(-1).level >= entry.level) stack.pop();
        const node = {...entry, children: []};
        if (stack.length) stack.at(-1).children.push(node);
        else roots.push(node);
        stack.push(node);
    }
    if (!roots.length) return 0;
    const context = doc.context;
    const rootRef = context.nextRef();
    const pageRefs = doc.getPages().map(page => page.ref);
    const writeSiblings = (nodes, parentRef) => {
        const refs = nodes.map(() => context.nextRef());
        let total = nodes.length;
        nodes.forEach((node, index) => {
            const children = node.children.length ? writeSiblings(node.children, refs[index]) : null;
            const dict = {
                Title: PDFHexString.fromText(node.title),
                Parent: parentRef,
                Dest: context.obj([pageRefs[node.pageIndex], PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull])
            };
            if (index > 0) dict.Prev = refs[index - 1];
            if (index + 1 < refs.length) dict.Next = refs[index + 1];
            if (children) {
                dict.First = children.first;
                dict.Last = children.last;
                dict.Count = children.total;
                total += children.total;
            }
            context.assign(refs[index], context.obj(dict));
        });
        return {first: refs[0], last: refs.at(-1), total};
    };
    const outline = writeSiblings(roots, rootRef);
    context.assign(rootRef, context.obj({
        Type: PDFName.of("Outlines"),
        First: outline.first,
        Last: outline.last,
        Count: outline.total
    }));
    doc.catalog.set(PDFName.of("Outlines"), rootRef);
    return outline.total;
}

async function replaceFirstPageWithCustomCover(pdfBuffer, coverPath) {
    const { PDFDocument } = await import("pdf-lib");
    const output = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
    const cover = await PDFDocument.load(fs.readFileSync(coverPath), { updateMetadata: false });
    if (cover.getPageCount() !== 1) throw new Error("Custom cover PDF must contain exactly one page.");
    if (output.getPageCount() < 1) throw new Error("The body PDF is empty; the cover cannot be replaced.");
    const [coverPage] = await output.copyPages(cover, [0]);
    output.removePage(0);
    output.insertPage(0, coverPage);
    return Buffer.from(await output.save());
}

async function postProcessPdf(filePath, {themeLabel: themeLabel, pageBackground: pageBackground, pageNumbers: pageNumbers, pageNumberAnchors: pageNumberAnchors, pageMargin: pageMargin, headerFooterStyle: headerFooterStyle, watermark: watermark, tocNumbers: tocNumbers, tocMarkers: tocMarkers, tocStyles: tocStyles, tocBookmarks: tocBookmarks}) {
    let PDFDocument, rgb, degrees, PDFName, PDFArray, PDFRef, PDFRawStream, PDFHexString, PDFNull, setCharacterSpacing, pushGraphicsState, popGraphicsState;
    try {
        ({PDFDocument: PDFDocument, rgb: rgb, degrees: degrees, PDFName: PDFName, PDFArray: PDFArray, PDFRef: PDFRef, PDFRawStream: PDFRawStream, PDFHexString: PDFHexString, PDFNull: PDFNull, setCharacterSpacing: setCharacterSpacing, pushGraphicsState: pushGraphicsState, popGraphicsState: popGraphicsState} = await (import("pdf-lib")));
    } catch (err) {
        if (watermark?.enabled) throw new Error(`Cannot add the PDF watermark because pdf-lib is unavailable: ${err.message}`);
        console.warn(`WARNING: Could not load pdf-lib (${err.message}); PDF post-processing will be skipped.`);
        return;
    }
    const doc = await PDFDocument.load(fs.readFileSync(filePath), {
        updateMetadata: false
    });
    if (pageBackground) {
        const comp = v => (v / 255).toFixed(4).replace(/^0\./, ".");
        const bgColor = `${comp(pageBackground.r)} ${comp(pageBackground.g)} ${comp(pageBackground.b)}`;
        const BASE_FILL_RE = /(q\n[\d.]+ 0 0 [\d.]+ 0 0 cm\n)([\d.]+ [\d.]+ [\d.]+ RG [\d.]+ [\d.]+ [\d.]+ rg)(?=\n\/G\d+ gs\n(?:\/Document <<\/MCID \d+ >>BDC\n)?0 0 [\d.]+ [\d.]+ re\nf)/;
        const contentsKey = PDFName.of("Contents");
        let restyled = 0;
        const pages = doc.getPages();
        for (const page of pages) {
            let first = page.node.get(contentsKey);
            if (first instanceof PDFArray) first = first.get(0);
            if (!(first instanceof PDFRef)) continue;
            const stream = doc.context.lookup(first);
            if (!(stream instanceof PDFRawStream)) continue;
            let inflated;
            try {
                inflated = zlib.inflateSync(Buffer.from(stream.contents));
            } catch {
                continue;
            }
            const text = inflated.toString("latin1");
            const head = text.slice(0, 600);
            let newText;
            if (BASE_FILL_RE.test(head)) {
                newText = head.replace(BASE_FILL_RE, `$1${bgColor} RG ${bgColor} rg`) + text.slice(600);
            } else {
                const {width: width, height: height} = page.getSize();
                newText = `q ${bgColor} rg 0 0 ${width.toFixed(2)} ${height.toFixed(2)} re f Q\n` + text;
            }
            const deflated = zlib.deflateSync(Buffer.from(newText, "latin1"));
            const dict = stream.dict.clone(doc.context);
            dict.set(PDFName.of("Length"), doc.context.obj(deflated.length));
            doc.context.assign(first, PDFRawStream.of(dict, new Uint8Array(deflated)));
            restyled += 1;
        }
        if (restyled === 0) {
            console.warn("WARNING: Could not adjust the page background; margin areas may differ slightly from the theme background.");
        }
    }
    doc.setTitle(metadataTitle);
    if (metadataAuthor) doc.setAuthor(metadataAuthor);
    if (metadataSubject) doc.setSubject(metadataSubject);
    if (metadataKeywords.length > 0) doc.setKeywords(metadataKeywords);
    doc.setCreator(`MtoPB v${bookVersion}`);
    doc.setProducer("Chromium (Electron) + pdf-lib");
    if (language) doc.setLanguage(language);
    const created = rawDate ? new Date(rawDate) : new Date;
    if (!Number.isNaN(created.getTime())) doc.setCreationDate(created);
    doc.setModificationDate(new Date);
    if (watermark?.enabled && String(watermark.text ?? "").trim()) {
        const fontkitModule = await import("@pdf-lib/fontkit");
        const fontkit = fontkitModule.default ?? fontkitModule;
        const fontRoot = path.resolve(process.env.MTOPB_PROJECT_ROOT ?? path.resolve(path.dirname(htmlOut), ".."));
        const fontPath = path.join(fontRoot, "fonts", "NotoSerifSC-Regular.ttf");
        if (!fs.existsSync(fontPath)) throw new Error(`PDF watermark font not found: ${fontPath}`);
        const text = String(watermark.text).trim();
        const colorText = String(watermark.color).replace(/^#/, "");
        if (!/^[0-9a-f]{6}$/i.test(colorText)) throw new Error("Invalid watermark color format.");
        const color = rgb(parseInt(colorText.slice(0, 2), 16) / 255, parseInt(colorText.slice(2, 4), 16) / 255, parseInt(colorText.slice(4, 6), 16) / 255);
        const opacity = Number(watermark.opacity);
        const style = watermark.style;
        const tiled = [ "tiled", "tiled-up", "tiled-horizontal" ].includes(style);
        const fontSize = Number(watermark.font_size);
        doc.registerFontkit(fontkit);
        const subsetBytes = await createFontSubset(fontPath, [ text ]);
        const font = await doc.embedFont(subsetBytes);
        for (const page of doc.getPages()) {
            const {width: width, height: height} = page.getSize();
            const textWidth = font.widthOfTextAtSize(text, fontSize);
            const textHeight = font.heightAtSize(fontSize);
            const ascent = font.heightAtSize(fontSize, { descender: false });
            const descent = textHeight - ascent;
            if (tiled) {
                const angle = style === "tiled" ? -35 : style === "tiled-up" ? 35 : 0;
                const radians = angle * Math.PI / 180;
                const gap = fontSize * 5;
                const lineStep = fontSize * 7;
                const columnStep = textWidth + gap;
                const marginX = textWidth + fontSize;
                const marginY = textWidth * Math.abs(Math.sin(radians)) + textHeight + fontSize;
                let row = 0;
                for (let y = -marginY; y <= height + marginY; y += lineStep, row += 1) {
                    const stagger = row % 2 ? columnStep / 2 : 0;
                    for (let x = -marginX + stagger; x <= width + marginX; x += columnStep) {
                        page.drawText(text, {
                            x: x,
                            y: y,
                            size: fontSize,
                            font: font,
                            color: color,
                            opacity: opacity,
                            rotate: degrees(angle)
                        });
                    }
                }
                continue;
            }
            const fitSize = fontSize;
            const fitWidth = font.widthOfTextAtSize(text, fitSize);
            const fitHeight = font.heightAtSize(fitSize);
            const fitAscent = font.heightAtSize(fitSize, { descender: false });
            const fitDescent = fitHeight - fitAscent;
            const angle = style === "diagonal" ? -35 : style === "diagonal-up" ? 35 : 0;
            const radians = angle * Math.PI / 180;
            const centerOffsetX = fitWidth / 2;
            const centerOffsetY = (fitAscent - fitDescent) / 2;
            const x = width / 2 - (centerOffsetX * Math.cos(radians) - centerOffsetY * Math.sin(radians));
            const y = height / 2 - (centerOffsetX * Math.sin(radians) + centerOffsetY * Math.cos(radians));
            page.drawText(text, {
                x: x,
                y: y,
                size: fitSize,
                font: font,
                color: color,
                opacity: opacity,
                rotate: degrees(angle)
            });
        }
    }
    let pageNumberEntries = [];
    if (pageNumbers) {
        if (Array.isArray(pageNumbers)) {
            pageNumberEntries = pageNumbers;
        } else if (Object.hasOwn(pageNumbers, "hasCover")) {
            pageNumberEntries = buildPageNumberEntries({
                ...pageNumbers,
                pageCount: doc.getPageCount()
            });
        } else {
            const skip = new Set((pageNumbers.skipIndexes ?? []).map(index => index < 0 ? doc.getPageCount() + index : index));
            let nextNumber = 1;
            for (let index = 0; index < doc.getPageCount(); index += 1) {
                if (pageNumbers.skipFirstPage && index === 0) continue;
                if (skip.has(index)) continue;
                pageNumberEntries.push({pageIndex: index, label: String(pageNumbers.skipFirstPage ? nextNumber++ : index + 1)});
            }
        }
    }
    if (pageNumberEntries.length > 0) {
        const fontkitModule = await import("@pdf-lib/fontkit");
        const fontkit = fontkitModule.default ?? fontkitModule;
        const fontRoot = path.resolve(process.env.MTOPB_PROJECT_ROOT ?? path.resolve(path.dirname(htmlOut), ".."));
        const fontPath = path.join(fontRoot, "fonts", "NotoSerifSC-Regular.ttf");
        if (!fs.existsSync(fontPath)) throw new Error(`PDF overlay font not found: ${fontPath}`);
        doc.registerFontkit(fontkit);
        const subsetBytes = await createFontSubset(fontPath, ["0123456789"]);
        const font = await doc.embedFont(subsetBytes);
        const pages = doc.getPages();
        const styleCfg = headerFooterStyle;
        const requireLength = (value, field) => {
            const result = cssLengthToMm(value);
            if (result === null) throw new Error(`book.yml is missing a valid pdf.${field} setting.`);
            return result;
        };
        const topMm = requireLength(pageMargin.top, "margin.top");
        const rightMm = requireLength(pageMargin.right, "margin.right");
        const offsetMm = requireLength(styleCfg.offset, "header_footer_style.offset");
        const headerSizeMm = requireLength(styleCfg.font_size, "header_footer_style.font_size");
        const colorText = String(styleCfg.color).replace(/^#/, "");
        const colorHex = colorText.length === 3 ? colorText.split("").map(c => c + c).join("") : colorText;
        if (!/^[0-9a-f]{6}$/i.test(colorHex)) throw new Error("book.yml is missing a valid pdf.header_footer_style.color setting.");
        const numberColor = rgb(parseInt(colorHex.slice(0, 2), 16) / 255, parseInt(colorHex.slice(2, 4), 16) / 255, parseInt(colorHex.slice(4, 6), 16) / 255);
        const sampleAnchor = pageNumberAnchors?.[0];
        for (const entry of pageNumberEntries) {
            const page = pages[entry.pageIndex];
            if (!page) continue;
            const {width: width, height: height} = page.getSize();
            const anchor = pageNumberAnchors?.find(item => item.pageIndex === entry.pageIndex) ?? sampleAnchor;
            const anchorHeight = anchor ? Math.max(1, Number(anchor.size) || anchor.rect[3] - anchor.rect[1]) : 0;
            const numberSize = anchorHeight || Math.min(11, Math.max(6, width * 11 / 594.96));
            const headerScale = numberSize / 11;
            const textWidth = font.widthOfTextAtSize(entry.label, numberSize);
            const baseline = anchor ? (Number.isFinite(anchor.baseline) ? anchor.baseline - 1 : anchor.rect[1] + numberSize * 0.285 - 1) : height - (topMm + offsetMm) * 72 / 25.4 - headerSizeMm * headerScale * 72 / 25.4 + 3.7 * headerScale;
            page.drawText(entry.label, {
                x: anchor ? anchor.rect[2] - textWidth : width - rightMm * 72 / 25.4 - textWidth,
                y: baseline,
                size: numberSize,
                font: font,
                color: numberColor
            });
        }
        for (const page of pages) {
            const annotations = page.node.Annots();
            if (!annotations) continue;
            for (let index = annotations.size() - 1; index >= 0; index -= 1) {
                const ref = annotations.get(index);
                const annotation = doc.context.lookup(ref);
                const action = annotation.lookup(PDFName.of("A"));
                const uri = action?.lookup(PDFName.of("URI"));
                if (uri?.decodeText?.() !== PAGE_NUMBER_ANCHOR_URL) continue;
                annotations.remove(index);
                if (ref instanceof PDFRef) doc.context.delete(ref);
            }
            if (annotations.size() === 0) page.node.delete(PDFName.of("Annots"));
        }
    }
    if (tocMarkers?.length) {
        if (tocMarkers.length !== tocNumbers?.length) {
            console.warn(`WARNING: Found ${tocMarkers.length} TOC page number markers, expected ${tocNumbers?.length ?? 0}; unresolved TOC page numbers will be left blank.`);
        }
        const fontkitModule = await import("@pdf-lib/fontkit");
        const fontkit = fontkitModule.default ?? fontkitModule;
        const fontRoot = path.resolve(process.env.MTOPB_PROJECT_ROOT ?? path.resolve(path.dirname(htmlOut), ".."));
        const fontPath = path.join(fontRoot, "fonts", "NotoSerifSC-Regular.ttf");
        if (!fs.existsSync(fontPath)) throw new Error(`PDF TOC font not found: ${fontPath}`);
        doc.registerFontkit(fontkit);
        const subsetBytes = await createFontSubset(fontPath, [ "0123456789." ]);
        const font = await doc.embedFont(subsetBytes);
        const parseCssColor = (value, field) => {
            const match = String(value).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
            if (!match) throw new Error(`Could not read the ${field} style color for the TOC page number: ${value}`);
            return rgb(Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255);
        };
        const tocRightEdgeByPage = new Map;
        for (const marker of tocMarkers) {
            if (!marker) continue;
            const pageIndex = marker.annotationPageIndex;
            tocRightEdgeByPage.set(pageIndex, Math.max(tocRightEdgeByPage.get(pageIndex) ?? -Infinity, marker.rightX));
        }
        const markerPages = new Set(tocMarkers.filter(Boolean).map(marker => marker.annotationPageIndex));
        for (const pageIndex of markerPages) {
            const page = doc.getPage(pageIndex);
            const annotations = page.node.Annots();
            if (!annotations) continue;
            for (let index = annotations.size() - 1; index >= 0; index -= 1) {
                const ref = annotations.get(index);
                const annotation = doc.context.lookup(ref);
                const action = annotation.lookup(PDFName.of("A"));
                const uri = action?.lookup(PDFName.of("URI"));
                if (!uri?.decodeText?.().startsWith(TOC_PAGE_MARKER_PREFIX)) continue;
                annotations.remove(index);
                if (ref instanceof PDFRef) doc.context.delete(ref);
            }
            if (annotations.size() === 0) page.node.delete(PDFName.of("Annots"));
        }
        for (let i = 0; i < tocMarkers.length; i += 1) {
            const marker = tocMarkers[i];
            if (!marker) continue;
            const page = doc.getPage(marker.pageIndex);
            if (!page) continue;
            const label = tocNumbers?.[i] ?? null;
            const style = tocStyles?.[i];
            if (!style) throw new Error(`Missing style configuration for TOC page number ${i + 1}.`);
            const fontSize = marker.fontSize;
            if (!Number.isFinite(fontSize) || fontSize <= 0) throw new Error(`TOC page number ${i + 1} is missing a valid font size.`);
            const baseline = marker.y + marker.height;
            const text = label === null || label === undefined ? "" : String(label);
            const textWidth = font.widthOfTextAtSize(text, fontSize);
            const rightEdge = tocRightEdgeByPage.get(marker.annotationPageIndex) ?? marker.rightX;
            const numberX = rightEdge - textWidth;
            const leaderSize = marker.leaderFontSize;
            const dotWidth = font.widthOfTextAtSize(".", leaderSize);
            const oneDigitWidth = font.widthOfTextAtSize("0", fontSize);
            const leaderEndX = rightEdge - oneDigitWidth - (dotWidth * 5 + marker.leaderSpacing * 4);
            const leaderWidth = leaderEndX - marker.leaderStartX;
            const dotCount = Math.max(0, Math.floor((leaderWidth + marker.leaderSpacing) / (dotWidth + marker.leaderSpacing)));
            if (dotCount > 0) {
                const spacing = dotCount > 1 ? (leaderWidth - dotCount * dotWidth) / (dotCount - 1) : 0;
                page.pushOperators(pushGraphicsState(), setCharacterSpacing(spacing));
                page.drawText(".".repeat(dotCount), {
                    x: marker.leaderStartX,
                    y: baseline,
                    size: leaderSize,
                    font: font,
                    color: parseCssColor(style.leaderColor, "TOC leader")
                });
                page.pushOperators(popGraphicsState());
            }
            if (!text) continue;
            page.drawText(String(label), {
                x: numberX,
                y: baseline,
                size: fontSize,
                font: font,
                color: parseCssColor(style.color, "page number")
            });
        }
    }
    if (tocBookmarks?.length) console.log(`Added ${addPdfBookmarks(doc, tocBookmarks, {PDFName, PDFHexString, PDFNull})} PDF bookmark(s) from the TOC.`);
    fs.writeFileSync(filePath, await doc.save());
}

async function preparePage(browser2, htmlPath) {
    let page;
    if (cdpEndpoint) {
        const context = browser2.contexts()[0];
        if (!context) throw new Error("The bundled Chromium runtime did not provide a default browser context.");
        for (const candidate of context.pages()) {
            if (cdpPagesInUse.has(candidate)) continue;
            const isPrintPage = await candidate.evaluate(() => window.name.startsWith("mtopb-render-"));
            if (isPrintPage) {
                page = candidate;
                cdpPagesInUse.add(page);
                break;
            }
        }
        if (!page) throw new Error("No preloaded Chromium print page is available.");
        await page.setViewportSize({
            width: 1280,
            height: 720
        });
    } else {
        page = await browser2.newPage({
            viewport: {
                width: 1280,
                height: 720
            }
        });
    }
    await page.goto(pathToFileURL(htmlPath).href, {
        waitUntil: "networkidle"
    });
    await page.emulateMedia({
        media: "print"
    });
    await page.evaluate(() => document.documentElement.classList.add("mhb-pdf"));
    await page.evaluate(() => document.fonts.ready);
    const fontLoadResults = await page.evaluate(async () => {
        const required = [
            [ "Noto Serif SC", "normal", "中文Aa" ],
            [ "Cascadia Code", "normal", "0123Aa" ],
            [ "Cascadia Code", "italic", "comment" ]
        ];
        const results = [];
        for (const [family, style, sample] of required) {
            const faces = await document.fonts.load(`${style} 12px "${family}"`, sample);
            results.push({
                family,
                style,
                loaded: faces.length > 0 && faces.every(face => face.status === "loaded")
            });
        }
        return results;
    });
    const missingFonts = fontLoadResults.filter(result => !result.loaded);
    if (missingFonts.length > 0) {
        throw new Error(`Failed to load required fonts: ${missingFonts.map(font => `${font.family} (${font.style})`).join(", ")}`);
    }
    return page;
}

async function releasePage(page) {
    if (cdpEndpoint) {
        await page.goto("about:blank");
        cdpPagesInUse.delete(page);
    } else {
        await page.close();
    }
}

async function pageBackgroundFrom(page) {
    const bodyBgRaw = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const bgMatch = String(bodyBgRaw).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (bgMatch && bgMatch[4] !== "0") {
        const [r, g, b] = [ Number(bgMatch[1]), Number(bgMatch[2]), Number(bgMatch[3]) ];
        if (!(r === 255 && g === 255 && b === 255)) return {
            r: r,
            g: g,
            b: b
        };
    }
    return null;
}

async function printPageToPDF(page, options) {
    if (!cdpEndpoint) return page.pdf(options);
    const pageName = await page.evaluate(() => window.name);
    const electronOptions = {};
    for (const key of ["landscape", "displayHeaderFooter", "printBackground", "scale", "pageSize", "margins", "pageRanges", "headerTemplate", "footerTemplate", "preferCSSPageSize"]) {
        if (options[key] !== undefined) electronOptions[key] = options[key];
    }
    if (options.tagged !== undefined) electronOptions.generateTaggedPDF = options.tagged;
    if (options.outline !== undefined) electronOptions.generateDocumentOutline = options.outline;
    const payload = Buffer.from(JSON.stringify({ pageName, options: electronOptions }));
    return new Promise((resolve, reject) => {
        const request = http.request(printEndpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${printToken}`,
                "Content-Type": "application/json",
                "Content-Length": payload.length
            }
        }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => {
                const body = Buffer.concat(chunks);
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`Electron PDF printing failed: ${body.toString("utf8")}`));
                    return;
                }
                resolve(body);
            });
            response.on("error", reject);
        });
        request.on("error", reject);
        request.end(payload);
    });
}

async function prepareTocPageNumbers(page) {
    return page.evaluate(marker => {
        document.body.classList.add("toc-has-pages");
        return Array.from(document.querySelectorAll("#toc .toc-page[data-target]"), (target, index) => {
            const targetStyle = getComputedStyle(target);
            const dots = target.parentElement.querySelector(".toc-leader-dots");
            const leaderColor = getComputedStyle(dots).color;
            dots.style.visibility = "hidden";
            target.style.position = "relative";
            target.style.width = "2.5em";
            target.style.textAlign = "right";
            const link = document.createElement("a");
            link.href = `${marker}${index}`;
            link.setAttribute("aria-hidden", "true");
            link.style.cssText = "position:absolute;right:0;bottom:0;display:block;width:100%;height:1em;border:0;background:none;text-decoration:none";
            target.replaceChildren(link);
            return {
                color: targetStyle.color,
                leaderColor: leaderColor
            };
        });
    }, TOC_PAGE_MARKER_PREFIX);
}

function buildPageNumberEntries({pageCount, hasCover, hasToc, hasBack, countCover, countToc, countBack, coverHeaderFooter, showCoverNumber, tocStartPage, tocPageCount, mainStartPage}) {
    const tocStart = tocStartPage ?? (hasCover ? 1 : 0);
    const tocEnd = tocStart + (tocPageCount ?? 0);
    const entries = [];
    let nextNumber = 1;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const isCover = hasCover && pageIndex === 0;
        const isToc = hasToc && pageIndex >= tocStart && pageIndex < tocEnd;
        const isBack = hasBack && pageIndex === pageCount - 1;
        const counted = !(isCover && !countCover) && !(isToc && !countToc) && !(isBack && !countBack);
        const showNumber = counted && !(isCover && !(showCoverNumber ?? coverHeaderFooter));
        if (showNumber) entries.push({pageIndex: pageIndex, label: String(nextNumber)});
        if (counted) nextNumber += 1;
    }
    return entries;
}

let browser;

try {
    if (cdpEndpoint) {
        browser = await chromium.connectOverCDP(cdpEndpoint);
    } else {
        if (!fs.existsSync(pdfRuntime)) {
            throw new Error(`Bundled Chromium executable not found: ${pdfRuntime}. Run "npm run package-pdf-runtime" first.`);
        }
        browser = await chromium.launch({
            executablePath: pdfRuntime
        });
    }
} catch (err) {
    console.error(cdpEndpoint ? "ERROR: Could not connect to the bundled Chromium runtime." : "ERROR: Could not start the bundled Chromium executable.");
    console.error(err.message);
    console.error('If bundled Chromium is not packaged, run: npm run package-pdf-runtime');
    process.exit(1);
}

try {
    for (const theme of themes) {
        const pdfCfg = mergePdfCfg(pdfBase, theme.pdf);
        const coverCfg = {
            ...coverBase,
            ...theme.cover
        };
        const backCfg = {
            ...backBase,
            ...theme.back_cover
        };
        const withHeaderFooter = pdfCfg.header_footer;
        const withTocPageNumbers = pdfCfg.toc_page_numbers;
        const coverHeaderFooter = pdfCfg.cover_header_footer;
        const coverEnabled = coverCfg.enabled;
        const backCoverEnabled = backCfg.enabled;
        const htmlPath = variantPath(htmlOut, theme);
        const pdfPath = variantPath(pdfOut, theme);
        if (!fs.existsSync(htmlPath)) {
            console.error(`ERROR: ${rel(htmlPath)} not found. Run "npm run build" first.`);
            process.exit(1);
        }
        const pageMargin = marginParts(pdfCfg.margin);
        const pageNumberCfg = pdfCfg.page_numbers;
        const countCover = pageNumberCfg.count_cover;
        const countToc = pageNumberCfg.count_toc;
        const countBackCover = pageNumberCfg.count_back_cover;
        const basePdfOptions = {
            preferCSSPageSize: true,
            printBackground: true,
            tagged: false,
            outline: true
        };
        const page = await preparePage(browser, htmlPath);
        const pdfOptions = {
            ...basePdfOptions,
            displayHeaderFooter: withHeaderFooter
        };
        if (withHeaderFooter) {
            pdfOptions.headerTemplate = "<span></span>";
            pdfOptions.footerTemplate = "<span></span>";
        }
        const present = await page.evaluate(() => ({
            cover: !!document.getElementById("cover"),
            toc: !!document.getElementById("toc"),
            back: !!document.getElementById("back-cover"),
            tocTargets: document.querySelectorAll(".toc-page[data-target]").length
        }));
        const hasCover = present.cover && coverEnabled;
        const hasBack = present.back && backCoverEnabled;
        const hasMainToc = present.toc;
        const doTocNumbers = withTocPageNumbers && present.tocTargets > 0;
        const needTocAnalysis = doTocNumbers || (withHeaderFooter && hasMainToc && !countToc);
        if (withHeaderFooter && coverHeaderFooter && hasCover && !countCover) {
            console.warn("WARNING: pdf.cover_header_footer is ignored when cover page numbering is disabled.");
        }
        const pageBackground = await pageBackgroundFrom(page);
        const tocStyles = doTocNumbers ? await prepareTocPageNumbers(page) : [];
        fs.mkdirSync(path.dirname(pdfPath), {
            recursive: true
        });
        console.log("PDF rendering: generating the body and adding page numbers and watermark.");
        let renderedBytes = await printPageToPDF(page, pdfOptions);
        if (pdfCfg.custom_cover_pdf) {
            renderedBytes = await replaceFirstPageWithCustomCover(renderedBytes, pdfCfg.custom_cover_pdf);
            console.log("Replaced the generated cover with the selected single-page PDF.");
        }
        let pageNumberAnchors = [];
        if (withHeaderFooter) {
            try {
                pageNumberAnchors = await resolvePageNumberAnchors(renderedBytes);
            } catch (err) {
                console.warn(`WARNING: Could not parse page number positioning markers: ${err.message}`);
            }
        }
        fs.writeFileSync(pdfPath, renderedBytes);
        let tocData = null;
        if (needTocAnalysis) {
            try {
                tocData = await resolveTocPageNumbers(renderedBytes, page, {
                    hasCover: hasCover,
                    hasToc: hasMainToc,
                    hasBack: hasBack,
                    countCover: countCover,
                    countToc: countToc,
                    countBack: countBackCover
                });
                if (tocData) {
                    if (doTocNumbers) console.log(`Parsed ${tocData.tocNumbers.filter(Boolean).length} TOC page number(s) from the generated PDF.`);
                    const tocMarkerCount = tocData.tocMarkers.filter(Boolean).length;
                    if (doTocNumbers && tocMarkerCount !== tocStyles.length) {
                        console.warn(`WARNING: TOC page number marker count mismatch (${tocMarkerCount}/${tocStyles.length}); unresolved entries will be left blank.`);
                        tocData.tocMarkers.length = tocStyles.length;
                        tocData.tocNumbers = Array(tocData.tocMarkers.length).fill(null);
                    }
                }
            } catch (err) {
                console.warn(`WARNING: Could not parse TOC page numbers: ${err.message}`);
            }
        }
        renderedBytes = null;
        const pageNumbers = withHeaderFooter ? {
            hasCover: hasCover,
            hasToc: hasMainToc,
            hasBack: hasBack,
            countCover: countCover,
            countToc: countToc,
            countBack: countBackCover,
            coverHeaderFooter: coverHeaderFooter,
            showCoverNumber: pageNumberCfg.show_cover ?? coverHeaderFooter,
            tocStartPage: tocData?.tocStartPage,
            tocPageCount: tocData?.tocPageCount,
            mainStartPage: tocData?.mainStartPage
        } : null;
        await releasePage(page);
        await postProcessPdf(pdfPath, {
            themeLabel: theme.isDefault ? "" : theme.label || theme.name,
            pageBackground: pageBackground,
            pageNumbers: pageNumbers,
            pageNumberAnchors: pageNumberAnchors,
            pageMargin: pageMargin,
            headerFooterStyle: pdfCfg.header_footer_style,
            watermark: pdfCfg.watermark,
            tocNumbers: doTocNumbers ? tocData?.tocNumbers : null,
            tocMarkers: doTocNumbers ? tocData?.tocMarkers : null,
            tocStyles: tocStyles,
            tocBookmarks: doTocNumbers ? tocData?.tocBookmarks : null
        });
        console.log(`Generated ${rel(pdfPath)}`);
    }
} finally {
    await browser.close();
}
