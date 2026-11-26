// Adapted from markdown-it's built-in strikethrough rule.
// GFM allows a matching pair of either one or two tildes.

function tokenize(state, silent) {
    const marker = state.src.charCodeAt(state.pos);
    if (silent || marker !== 0x7e) return false;

    const scanned = state.scanDelims(state.pos, true);
    let length = scanned.length;
    if (length < 1) return false;

    if (length > 2) {
        const token = state.push("text", "", 0);
        token.content = "~".repeat(length);
        state.pos += length;
        return true;
    }

    const tilde = "~";
    const addDelimiter = delimiterLength => {
        const token = state.push("text", "", 0);
        token.content = tilde.repeat(delimiterLength);
        state.delimiters.push({
            marker: marker,
            length: 0,
            token: state.tokens.length - 1,
            end: -1,
            open: scanned.can_open,
            close: scanned.can_close,
            tildeLength: delimiterLength
        });
    };

    addDelimiter(length);

    state.pos += scanned.length;
    return true;
}

function postProcess(state, delimiters) {
    for (let index = 0; index < delimiters.length; index += 1) {
        const startDelimiter = delimiters[index];
        if (startDelimiter.marker !== 0x7e || startDelimiter.end === -1) continue;
        const endDelimiter = delimiters[startDelimiter.end];
        if (!endDelimiter || startDelimiter.tildeLength !== endDelimiter.tildeLength) continue;

        const openToken = state.tokens[startDelimiter.token];
        const closeToken = state.tokens[endDelimiter.token];
        if (openToken.type !== "text" || closeToken.type !== "text") continue;

        const markup = openToken.content;
        openToken.type = "s_open";
        openToken.tag = "del";
        openToken.nesting = 1;
        openToken.markup = markup;
        openToken.content = "";

        closeToken.type = "s_close";
        closeToken.tag = "del";
        closeToken.nesting = -1;
        closeToken.markup = markup;
        closeToken.content = "";

    }
}

function postProcessAll(state) {
    postProcess(state, state.delimiters);
    for (const tokenMeta of state.tokens_meta) {
        if (tokenMeta?.delimiters) postProcess(state, tokenMeta.delimiters);
    }
}

export default function gfmStrikethrough(md) {
    md.inline.ruler.at("strikethrough", tokenize);
    md.inline.ruler2.at("strikethrough", postProcessAll);
}
