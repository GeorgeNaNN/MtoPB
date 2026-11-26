import path from "node:path";

import { fileURLToPath, pathToFileURL } from "node:url";

function codeRunLength(line, start) {
    let end = start;
    while (line[end] === "`") end += 1;
    return end - start;
}

function normalizeImageDestination(inner, baseDir = "") {
    const trimmed = inner.trim();
    if (!trimmed) return inner;
    const titleMatch = trimmed.match(/^(.*?)(\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))\s*$/s);
    let destination = (titleMatch?.[1] ?? trimmed).trim();
    const title = titleMatch?.[2] ?? "";
    if (destination.startsWith("<") && destination.endsWith(">")) destination = destination.slice(1, -1).trim();
    if (!destination) return inner;
    if (!baseDir) {
        if (trimmed.startsWith("<")) return inner;
        const hasUnescapedSpace = /(^|[^\\])\s/.test(destination);
        return hasUnescapedSpace ? `<${destination}>${title}` : inner;
    }
    if (destination.startsWith("#") || /^(?:https?:|data:|blob:|mailto:|tel:|\/\/)/i.test(destination)) return inner;
    if (!/^[A-Za-z]:[\\/]/.test(destination) && !/^file:/i.test(destination) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)) return inner;
    const suffix = destination.match(/[?#].*$/)?.[0] ?? "";
    const rawPath = suffix ? destination.slice(0, -suffix.length) : destination;
    if (!rawPath) return inner;
    let decoded = rawPath;
    if (/^file:/i.test(rawPath)) {
        try {
            decoded = fileURLToPath(rawPath);
        } catch {
            return inner;
        }
    } else {
        try {
            decoded = decodeURIComponent(rawPath);
        } catch {}
    }
    decoded = decoded.replaceAll("\\", path.sep);
    const resolved = path.isAbsolute(decoded) ? decoded : path.resolve(baseDir, decoded);
    const resolvedPath = resolved.split(path.sep).join("/");
    return `<${resolvedPath}${suffix}>${title}`;
}
function findDestinationEnd(line, openIndex) {
    let depth = 1;
    let quote = "";
    let inAngle = false;
    for (let index = openIndex + 1; index < line.length; index += 1) {
        const char = line[index];
        if (char === "\\") {
            index += 1;
            continue;
        }
        if (quote) {
            if (char === quote) quote = "";
            continue;
        }
        if (inAngle) {
            if (char === ">") inAngle = false;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === "<") {
            inAngle = true;
            continue;
        }
        if (char === "(") depth += 1;
        if (char === ")" && --depth === 0) return index;
    }
    return -1;
}

function normalizeImagesOutsideCode(line, baseDir = "") {
    let output = "";
    let cursor = 0;
    while (cursor < line.length) {
        const tickStart = line.indexOf("`", cursor);
        if (tickStart === -1) {
            output += transformPlainSegment(line.slice(cursor), baseDir);
            break;
        }
        output += transformPlainSegment(line.slice(cursor, tickStart), baseDir);
        const runLength = codeRunLength(line, tickStart);
        const fence = "`".repeat(runLength);
        const tickEnd = line.indexOf(fence, tickStart + runLength);
        if (tickEnd === -1) {
            output += line.slice(tickStart);
            break;
        }
        output += line.slice(tickStart, tickEnd + runLength);
        cursor = tickEnd + runLength;
    }
    return output;
}

function transformPlainSegment(segment, baseDir = "") {
    let output = "";
    let cursor = 0;
    while (cursor < segment.length) {
        const imageStart = segment.indexOf("![", cursor);
        if (imageStart === -1) {
            output += segment.slice(cursor);
            break;
        }
        let slashCount = 0;
        for (let index = imageStart - 1; index >= 0 && segment[index] === "\\"; index -= 1) slashCount += 1;
        if (slashCount % 2 === 1) {
            output += segment.slice(cursor, imageStart + 2);
            cursor = imageStart + 2;
            continue;
        }
        const closeAlt = segment.indexOf("]", imageStart + 2);
        if (closeAlt === -1 || segment[closeAlt + 1] !== "(") {
            output += segment.slice(cursor, imageStart + 2);
            cursor = imageStart + 2;
            continue;
        }
        const closeDestination = findDestinationEnd(segment, closeAlt + 1);
        if (closeDestination === -1) {
            output += segment.slice(cursor, imageStart + 2);
            cursor = imageStart + 2;
            continue;
        }
        const beforeDestination = segment.slice(imageStart, closeAlt + 2);
        const inner = segment.slice(closeAlt + 2, closeDestination);
        const normalized = normalizeImageDestination(inner, baseDir);
        output += segment.slice(cursor, imageStart) + beforeDestination + normalized + ")";
        cursor = closeDestination + 1;
    }
    return output;
}

export function normalizeMarkdownImagePaths(source, baseDir = "") {
    const lines = String(source ?? "").split(/\r?\n/);
    let fenceCharacter = "";
    let fenceLength = 0;
    return lines.map(line => {
        const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
        if (fence) {
            const character = fence[1][0];
            if (!fenceCharacter) {
                fenceCharacter = character;
                fenceLength = fence[1].length;
            } else if (character === fenceCharacter && fence[1].length >= fenceLength && !fence[2].trim()) {
                fenceCharacter = "";
                fenceLength = 0;
            }
            return line;
        }
        return fenceCharacter ? line : normalizeImagesOutsideCode(line, baseDir);
    }).join("\n");
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
    decoded = decoded.replaceAll("\\", path.sep);
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

function rewriteRawHtmlResources(source, baseDir) {
    let output = String(source);
    const protectedScripts = [];
    output = output.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (whole, open, body, close) => {
        const index = protectedScripts.push(rewriteHtmlResourceAttributes(open, baseDir) + body + close) - 1;
        return `\uE200MTOPB_SCRIPT_${index}\uE201`;
    });
    output = output.replace(/<(img|source|video|audio|iframe|link|object)\b[^>]*>/gi, tag => rewriteHtmlResourceAttributes(tag, baseDir));
    output = output.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (whole, open, css, close) => rewriteHtmlResourceAttributes(open, baseDir) + rewriteCssResourceUrls(css, baseDir) + close);
    output = output.replace(/(\bstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (whole, prefix, quote, css) => prefix + quote + rewriteCssResourceUrls(css, baseDir) + quote);
    return output.replace(/\uE200MTOPB_SCRIPT_(\d+)\uE201/g, (_whole, index) => protectedScripts[Number(index)] ?? "");
}

function maskFencedCode(source) {
    const lines = String(source).split(/\r?\n/);
    const blocks = [];
    const output = [];
    let current = null;
    let fenceCharacter = "";
    let fenceLength = 0;
    for (const line of lines) {
        const match = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
        if (!current) {
            if (match) {
                current = [line];
                fenceCharacter = match[1][0];
                fenceLength = match[1].length;
            } else {
                output.push(line);
            }
            continue;
        }
        current.push(line);
        if (match && match[1][0] === fenceCharacter && match[1].length >= fenceLength && !match[2].trim()) {
            const token = `\uE200MTOPB_FENCE_${blocks.push(current.join("\n")) - 1}\uE201`;
            output.push(token);
            current = null;
        }
    }
    if (current) output.push(current.join("\n"));
    return { source: output.join("\n"), blocks };
}

function maskInlineCode(source) {
    const spans = [];
    let output = "";
    let cursor = 0;
    while (cursor < source.length) {
        const start = source.indexOf("`", cursor);
        if (start === -1) {
            output += source.slice(cursor);
            break;
        }
        output += source.slice(cursor, start);
        let length = 1;
        while (source[start + length] === "`") length += 1;
        const fence = "`".repeat(length);
        const end = source.indexOf(fence, start + length);
        if (end === -1) {
            output += source.slice(start);
            break;
        }
        const token = `\uE200MTOPB_INLINE_${spans.push(source.slice(start, end + length)) - 1}\uE201`;
        output += token;
        cursor = end + length;
    }
    return { source: output, spans };
}

export function resolveMarkdownResources(source, baseDir) {
    if (!baseDir) throw new Error("A base directory is required to resolve Markdown resources.");
    const fenced = maskFencedCode(source);
    const inline = maskInlineCode(fenced.source);
    let resolved = rewriteRawHtmlResources(inline.source, baseDir);
    resolved = resolved.replace(/\uE200MTOPB_INLINE_(\d+)\uE201/g, (_whole, index) => inline.spans[Number(index)] ?? "");
    resolved = resolved.replace(/\uE200MTOPB_FENCE_(\d+)\uE201/g, (_whole, index) => fenced.blocks[Number(index)] ?? "");
    return normalizeMarkdownImagePaths(resolved, baseDir);
}

