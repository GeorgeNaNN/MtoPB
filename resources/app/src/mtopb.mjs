import fs from "node:fs";

import path from "node:path";

import { spawnSync } from "node:child_process";

import { fileURLToPath, pathToFileURL } from "node:url";

import YAML from "yaml";

import { resolveMarkdownResources } from "./lib/markdown-images.mjs";

const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const root = path.resolve(process.env.MTOPB_PROJECT_ROOT ?? codeRoot);

const scriptRoot = path.resolve(process.env.MTOPB_CODE_ROOT ?? codeRoot);

const outputDir = path.resolve(process.env.MTOPB_OUTPUT_DIR ?? path.join(root, "res"));

const outputBaseName = path.basename(process.env.MTOPB_OUTPUT_BASENAME ?? "MtoPB").replace(/\.(?:pdf|md|html|log)$/i, "") || "MtoPB";

const tempDir = path.join(outputDir, "tmp");

const logPath = path.join(outputDir, `${outputBaseName}.log`);

function progress(step, total, label) {
    const filled = Math.round(step / total * 20);
    console.log(`[${"#".repeat(filled)}${".".repeat(20 - filled)}] ${step}/${total} ${label}`);
}

function writeLog(title, content = "") {
    fs.appendFileSync(logPath, `\n===== ${title} =====\n${content}\n`, "utf8");
}

function resolveFromRoot(value) {
    return path.resolve(root, String(value));
}

function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function runScript(title, script, generatedConfig) {
    const sourcePath = path.join(scriptRoot, "src", script);
    const bundledPath = sourcePath.replace(/\.mjs$/i, ".js");
    const scriptPath = fs.existsSync(bundledPath) ? bundledPath : sourcePath;
    const result = spawnSync(process.execPath, [ scriptPath, "--config", generatedConfig ], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        env: process.env.ELECTRON_RUN_AS_NODE === "1" ? process.env : {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1"
        }
    });
    writeLog(title, `${result.stdout ?? ""}${result.stderr ?? ""}`);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${title} failed. See res/${outputBaseName}.log for details.`);
}

function readConfig(providedConfig) {
    const config = providedConfig;
    if (!config || typeof config !== "object") throw new Error("The conversion job does not include a valid configuration.");
    if (!Array.isArray(config.covers) || config.covers.length === 0) {
        throw new Error('config.yml: covers must be a non-empty array.');
    }
    if (!config.version || !config.cover_type || !config.watermark || !config.pdf_metadata) {
        throw new Error("config.yml is missing a required version, cover_type, watermark, or pdf_metadata setting.");
    }
    if (!Number.isInteger(config.selected_cover) || config.selected_cover < 1) {
        throw new Error('config.yml: selected_cover must be a positive integer.');
    }
    const ids = new Set;
    for (const cover2 of config.covers) {
        const coverId = Number(cover2.id);
        if (!Number.isInteger(coverId) || coverId < 1 || ids.has(coverId)) {
            throw new Error("config.yml: each cover must have a unique positive integer ID.");
        }
        ids.add(coverId);
        if (typeof cover2.main_title !== "string") throw new Error(`config.yml: covers[${coverId}].main_title must be a string.`);
        if (coverId === 1) {
            for (const key of [ "subtitle", "link_url", "link_text", "link_color", "image" ]) {
                if (typeof cover2[key] !== "string") throw new Error(`config.yml: covers[1].${key} must be a string.`);
            }
            if (!/^#[0-9a-f]{6}$/i.test(String(cover2.link_color))) throw new Error("config.yml: covers[1].link_color must be a 6-digit hexadecimal color.");
            if (typeof cover2.use_image !== "boolean") throw new Error("config.yml: covers[1].use_image must be a boolean.");
            const width = Number(cover2.image_width_percent);
            if (!Number.isFinite(width) || width < 0) throw new Error("config.yml: covers[1].image_width_percent must be a number greater than or equal to 0.");
        }
        if (coverId === 3 && typeof cover2.subtitle !== "string") throw new Error("config.yml: covers[3].subtitle must be a string.");
        if ([2, 3, 4].includes(coverId)) {
            if (typeof cover2.author !== "string" || typeof cover2.date !== "string") throw new Error(`config.yml: covers[${coverId}].author and date must be strings.`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(cover2.date)) throw new Error(`config.yml: covers[${coverId}].date must use the YYYY-MM-DD format.`);
        }
        if (coverId === 4) {
            for (const key of ["frame_top_cm", "frame_horizontal_cm", "frame_bottom_cm"]) {
                const offset = Number(cover2[key]);
                if (!Number.isFinite(offset) || offset < 0) throw new Error(`config.yml: covers[4].${key} must be a number greater than or equal to 0.`);
            }
        }
    }
    if (!["template", "custom"].includes(config.cover_type)) throw new Error("config.yml: Invalid cover_type.");
    for (const [key, label] of [["image_pagination", "image"], ["code_block_pagination", "code block"], ["table_pagination", "table"]]) {
        if (!["auto", "avoid"].includes(config[key])) throw new Error(`config.yml: Invalid ${label}_pagination.`);
    }
    if (config.cover_type === "custom" && (!config.custom_cover_pdf || !fs.existsSync(config.custom_cover_pdf))) throw new Error("Custom cover PDF not found. Select it again.");
    const cover = config.covers.find(item => item.id === config.selected_cover);
    if (!cover) throw new Error(`config.yml: No cover found with ID ${config.selected_cover}.`);
    return {
        config: config,
        cover: cover
    };
}

function checkRequiredFonts() {
    const requiredFonts = [
        "NotoSerifSC-Regular.ttf",
        "NotoSerifSC-SemiBold.ttf",
        "NotoSerifSC-Bold.ttf",
        "CascadiaCode-SemiLight.ttf",
        "CascadiaCode-SemiLightItalic.ttf"
    ];
    for (const name of requiredFonts) {
        const fontPath = path.join(root, "fonts", name);
        if (!fs.existsSync(fontPath) || !fs.statSync(fontPath).isFile()) {
            throw new Error(`Required font file not found: ${path.join("fonts", name)}`);
        }
    }
}

function createCover(cover, tempDir2) {
    const templatePath = path.join(root, "covers", `${cover.id}.html`);
    if (!fs.existsSync(templatePath)) throw new Error(`Cover template not found: covers/${cover.id}.html`);
    let imageBlock = "";
    const imageWidth = Number(cover.image_width_percent);
    if (cover.use_image && cover.image && Number.isFinite(imageWidth) && imageWidth > 0) {
        try {
            const imagePath = resolveFromRoot(cover.image);
            if (fs.statSync(imagePath).isFile()) {
                const imageUrl = pathToFileURL(imagePath).href;
                imageBlock = `<img class="cover-image" src="${escapeHtml(imageUrl)}" alt="" style="--cover-image-width:${Math.min(100, imageWidth)}%">`;
            }
        } catch {}
    }
    const author = [2, 3, 4].includes(Number(cover.id)) ? String(cover.author).trim() : "";
    const date = [2, 3, 4].includes(Number(cover.id)) ? String(cover.date).trim() : "";
    const metaClass = author && date ? "has-both" : author ? "has-author" : date ? "has-date" : "is-empty";
    const metaRow = (label, value) => value ? `<p class="cover-meta-row">${label}：${escapeHtml(value)}</p>` : "";
    const frameTop = Number(cover.frame_top_cm);
    const frameHorizontal = Number(cover.frame_horizontal_cm);
    const frameBottom = Number(cover.frame_bottom_cm);
    const values = {
        main_title: escapeHtml(cover.main_title),
        subtitle: escapeHtml([1, 3].includes(Number(cover.id)) ? cover.subtitle : ""),
        author_row: metaRow("作者", author),
        date_row: metaRow("日期", date),
        meta_class: metaClass,
        frame_top: Number.isFinite(frameTop) && frameTop >= 0 ? frameTop.toFixed(4) : "",
        frame_horizontal: Number.isFinite(frameHorizontal) && frameHorizontal >= 0 ? frameHorizontal.toFixed(4) : "",
        frame_bottom: Number.isFinite(frameBottom) && frameBottom >= 0 ? frameBottom.toFixed(4) : "",
        link_url: escapeHtml(Number(cover.id) === 1 ? cover.link_url : ""),
        link_text: escapeHtml(Number(cover.id) === 1 ? cover.link_text : ""),
        link_color: Number(cover.id) === 1 ? escapeHtml(cover.link_color) : "",
        image_block: imageBlock
    };
    const html = fs.readFileSync(templatePath, "utf8").replace(/\{\{(\w+)\}\}/g, (whole, key) => Object.hasOwn(values, key) ? values[key] : whole);
    const coverPath = path.join(tempDir2, "cover.html");
    fs.writeFileSync(coverPath, html, "utf8");
    return coverPath;
}

function createBookConfig(config, cover, chapters, coverPath) {
    const pdfMetadata = config.pdf_metadata;
    const metadataKeywords = String(pdfMetadata.keywords).split(/[,，\r\n]+/).map(item => item.trim()).filter(Boolean);
    return {
        title: cover.main_title,
        subtitle: String(cover.subtitle ?? ""),
        version: String(config.version),
        language: "zh-CN",
        authors: cover.author ? [ String(cover.author) ] : [],
        date: String(cover.date ?? ""),
        date_format: "YYYY-MM-DD",
        metadata: {
            title: String(pdfMetadata.title),
            author: String(pdfMetadata.author),
            subject: String(pdfMetadata.subject),
            keywords: metadataKeywords
        },
        chapters: chapters,
        output: {
            html: path.join(outputDir, `${outputBaseName}.html`),
            pdf: path.join(outputDir, `${outputBaseName}.pdf`)
        },
        toc: {
            enabled: true,
            title: String(config.toc_title),
            depth: Number(config.toc_depth)
        },
        chapter_toc: {
            default: false,
            title: "In this chapter",
            depth: 3,
            class: ""
        },
        labels: {},
        pdf: {
            header_footer: true,
            toc_page_numbers: true,
            cover_header_footer: false,
            link_annotation_color: String(config.link_annotation_color),
            page_size: String(config.page_size),
            margin: String(config.page_margin),
            image_pagination: config.image_pagination,
            code_block_pagination: config.code_block_pagination,
            table_pagination: config.table_pagination,
            page_numbers: {
                format: "{{page}}",
                count_cover: config.page_number_start === "cover",
                count_toc: config.page_number_start !== "body",
                count_back_cover: false,
                show_cover: config.page_number_start === "cover"
            },
            header: {
                left: "{{section}}",
                center: "",
                right: ""
            },
            footer: {
                left: "",
                center: "",
                right: ""
            },
            header_footer_style: {
                font_size: "11.01pt",
                color: "#444444",
                offset: "2.49mm",
                font_family: ""
            },
            date_format: "YYYY-MM-DD",
            custom_cover_pdf: config.cover_type === "custom" ? config.custom_cover_pdf : null,
            watermark: config.watermark.enabled ? {
                ...config.watermark,
                opacity: Number(config.watermark.opacity),
                font_size: Number(config.watermark.font_size)
            } : { enabled: false }
        },
        back_cover: {
            enabled: false
        },
        cover: {
            enabled: true,
            html: coverPath,
            layout: cover.id
        },
        style: {
            print_font_size: "10.09pt",
            code_line_numbers: config.code_line_numbers,
            custom_css: [path.join(codeRoot, "templates", "mtopb.css")],
            fonts: {}
        },
        themes: [{ name: "default", label: "", default: true, style: {}, cover: {}, back_cover: {}, pdf: {} }]
    };
}

function main() {
    let chapters;
    let providedConfig;
    try {
        const jobPath = process.env.MTOPB_JOB_FILE;
        if (!jobPath || !fs.existsSync(jobPath)) {
            throw new Error("No conversion job was received.");
        }
        const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
        if (!Array.isArray(job.files) || job.files.length === 0) {
            throw new Error("Select at least one Markdown file.");
        }
        chapters = sortSelectedFiles(job.files.map(file => path.resolve(String(file))));
        providedConfig = job.config;
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    fs.mkdirSync(tempDir, {
        recursive: true
    });
    fs.writeFileSync(logPath, `MtoPB v${providedConfig.version} conversion log\n`, "utf8");
    try {
        progress(1, 7, "Reading configuration");
        const {config: config, cover: cover} = readConfig(providedConfig);
        checkRequiredFonts();
        progress(2, 7, "Combining Markdown files");
        const combinedPath = path.join(outputDir, `${outputBaseName}.md`);
        const combined = chapters.map(file => {
            const source = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trimEnd();
            return resolveMarkdownResources(source, path.dirname(file));
        }).join("\n\n") + "\n";
        fs.writeFileSync(combinedPath, combined, "utf8");
        writeLog("Markdown merge", `Merged ${chapters.length} file(s):\n${chapters.join("\n")}`);
        progress(3, 7, "Preparing cover and document configuration");
        const coverPath = createCover(cover, tempDir);
        const generatedConfig = path.join(tempDir, "book.yml");
        fs.writeFileSync(generatedConfig, YAML.stringify(createBookConfig(config, cover, [ combinedPath ], coverPath)), "utf8");
        progress(4, 7, "Checking Markdown and configuration");
        runScript("Content validation", "check.mjs", generatedConfig);
        progress(5, 7, "Rendering HTML");
        runScript("HTML generation", "build.mjs", generatedConfig);
        progress(6, 7, "Rendering PDF with Chromium");
        runScript("PDF generation", "render-pdf.mjs", generatedConfig);
        progress(7, 7, "Finalizing output");
        fs.rmSync(tempDir, {
            recursive: true,
            force: true
        });
    } catch (error) {
        writeLog("Conversion error", error?.stack ?? String(error));
        try {
            fs.rmSync(tempDir, {
                recursive: true,
                force: true
            });
        } catch (cleanupError) {
            writeLog("Temporary file cleanup error", cleanupError?.stack ?? String(cleanupError));
            console.error(`ERROR: could not remove temporary files: ${cleanupError.message}`);
        }
        console.error(`ERROR: ${error.message}`);
        console.error(`Details: ${logPath}`);
        process.exitCode = 1;
    }
}

function sortSelectedFiles(files) {
    if (files.length === 1) {
        if (!/\.(?:md|markdown)$/i.test(files[0])) throw new Error(`Not a valid Markdown file: ${files[0]}`);
        return files;
    }
    const entries = files.map(file => {
        const name = path.basename(file);
        const order = name.match(/^(\d+)-.+\.(?:md|markdown)$/i)?.[1];
        return { file, name, order };
    });
    const invalid = entries.filter(entry => entry.order === undefined);
    if (invalid.length) throw new Error(`Multiple files must use the "number-name.md" format:\n${invalid.map(entry => entry.name).join("\n")}`);
    entries.sort((a, b) => {
        const left = BigInt(a.order);
        const right = BigInt(b.order);
        return (left < right ? -1 : left > right ? 1 : 0) || a.name.localeCompare(b.name, "en");
    });
    return entries.map(entry => entry.file);
}

main();
