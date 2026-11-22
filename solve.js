// csv-reader-speed: a fast drop-in for csv-reader 1.0.0 (make.fun).
//
// It answers exactly what csv-reader 1.0.0 answers for every {text, header}:
// {columns, rows, errors} under its broken-row policy (a U+FEFF at the very
// start dropped; records end at LF or CRLF; empty lines are no record; a
// stray CR outside quotes is dropped with a stray_cr error; a field opening
// with a quote runs to the next non-doubled quote, "" inside it is one
// quote, CRLF or a lone CR inside it reads as LF; junk after the closing
// quote up to the next comma or line break is appended as it stands, with a
// quote_junk error when the field ends; a quote that never closes is a
// literal and the text after it is re-read as unquoted, with an
// unterminated_quote error; a quote inside an unquoted field is literal;
// fields stay strings; columns is the first record when header is true;
// rows are padded with "" (short_row) or cut (long_row) to the first
// record's width; errors are {code, line, row} in the order met).
//
// Speed comes from never walking the text a character at a time on the hot
// path. Each record's end is found once (recEnd, the first LF at or after
// the record's start) together with a flag saying whether the record holds
// any CR other than the CRLF that may end it (recClean). A record with no
// quote in it is cut in one native call (split on ','); an unquoted field
// otherwise needs only one indexOf for its comma and a slice; a quoted
// field whose closing quote lies before recEnd in a clean record needs only
// one indexOf for its quote and a slice. The slow slice-by-slice work only
// runs for the rare broken shapes (a stray CR, a doubled quote, a line
// break inside quotes, junk after a closing quote, an unterminated quote).

/** Line breaks inside a quoted field: CRLF, a lone CR, or LF, each one. */
const LINE_BREAKS = /\r\n|\r|\n/g;
/** A CR or CRLF inside a quoted field, each read as one LF. */
const CR_OR_CRLF = /\r\n?/g;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  recordLoop:
  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    // The record being read: the line it starts on and the index in rows
    // it takes (null: the header).
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let quoted = false;

    // The end of this record's line: the first LF at or after pos, or the
    // end of the text. recClean says the span up to it holds no CR except
    // possibly the CRLF that ends it, so no field in the span can hold a
    // stray CR and no quoted field in it can hold a line break. Both are
    // recomputed whenever a quoted field spans a line break.
    let recEnd = text.indexOf('\n', pos);
    if (recEnd === -1) recEnd = n;
    let crAt = text.indexOf('\r', pos);
    let recClean = crAt === -1 || crAt >= recEnd || (recEnd < n && crAt === recEnd - 1);

    if (recClean) {
      // A record with no quote in it is cut in one native call: its fields
      // are the record's text, less a trailing CR of a CRLF, split on ','.
      const q = text.indexOf('"', pos);
      if (q === -1 || q >= recEnd) {
        const end = recEnd < n && text.charCodeAt(recEnd - 1) === 13 ? recEnd - 1 : recEnd;
        fields = text.slice(pos, end).split(',');
        if (recEnd < n) { pos = recEnd + 1; line += 1; }
        else pos = n;
      }
    }

    if (fields === null) {
    fields = [];
    fieldLoop:
    while (true) {
      let value;
      let ended; // 0: comma (the record goes on), 1: line break, 2: end of text
      let prefix = ''; // characters already kept, for a field re-read as unquoted
      let junkCheck = false; // the field came from a closing quote plus junk
      let doUnquoted = false;

      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        const lineBefore = line;
        let segStart = pos + 1; // start of the segment still to read
        let val = '';
        let closedAt = -1; // position just past the closing quote, or -1
        while (true) {
          const q = text.indexOf('"', segStart);
          if (q === -1) break; // no closing quote: unterminated
          if (text.charCodeAt(q + 1) === 34) {
            // A doubled quote: the segment up to it, then one quote.
            if (q < recEnd && recClean) {
              val += text.slice(segStart, q);
            } else {
              const s = text.slice(segStart, q);
              const m = s.match(LINE_BREAKS);
              if (m !== null) line += m.length;
              val += s.replace(CR_OR_CRLF, '\n');
            }
            val += '"';
            segStart = q + 2;
            continue;
          }
          // The closing quote: the segment up to it.
          if (q < recEnd && recClean) {
            val += text.slice(segStart, q);
          } else {
            const s = text.slice(segStart, q);
            const m = s.match(LINE_BREAKS);
            if (m !== null) line += m.length;
            val += s.replace(CR_OR_CRLF, '\n');
          }
          closedAt = q + 1;
          break;
        }
        if (closedAt === -1) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          prefix = '"';
          doUnquoted = true;
        } else {
          pos = closedAt;
          if (line !== lineBefore) {
            // The quoted field spanned a line break: the record's end moved.
            recEnd = text.indexOf('\n', pos);
            if (recEnd === -1) recEnd = n;
            crAt = text.indexOf('\r', pos);
            recClean = crAt === -1 || crAt >= recEnd || (recEnd < n && crAt === recEnd - 1);
          }
          if (pos >= n) { value = val; ended = 2; }
          else {
            const c = text.charCodeAt(pos);
            if (c === 44) { pos += 1; value = val; ended = 0; }
            else if (c === 10) { pos += 1; line += 1; value = val; ended = 1; }
            else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; value = val; ended = 1; }
            else {
              // What follows the closing quote is appended as it stands,
              // up to the next comma or line break.
              prefix = val;
              junkCheck = true;
              doUnquoted = true;
            }
          }
        }
      } else {
        quoted = false;
        doUnquoted = true;
      }

      if (doUnquoted) {
        // Reads unquoted characters onto `prefix` up to the next comma or
        // line break: a CR not followed by LF is dropped (stray_cr). The
        // field ends at the next comma before recEnd, or at recEnd itself.
        if (recClean) {
          const comma = text.indexOf(',', pos);
          let seg;
          if (comma !== -1 && comma < recEnd) {
            seg = text.slice(pos, comma);
            pos = comma + 1;
            ended = 0;
          } else if (recEnd < n) {
            seg = recEnd > pos && text.charCodeAt(recEnd - 1) === 13 ? text.slice(pos, recEnd - 1) : text.slice(pos, recEnd);
            pos = recEnd + 1;
            line += 1;
            ended = 1;
          } else {
            seg = text.slice(pos);
            pos = n;
            ended = 2;
          }
          value = prefix === '' ? seg : prefix + seg;
          if (junkCheck && seg.length > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        } else {
          // A stray CR may sit in the field: walk it in slices, one stray
          // CR at a time, dropping each with its error.
          let v = prefix;
          let kept = 0;
          let e2 = 2;
          while (true) {
            const c2 = text.indexOf(',', pos);
            const l2 = text.indexOf('\n', pos);
            const r2 = text.indexOf('\r', pos);
            let e3;
            let k3;
            if (c2 !== -1 && (l2 === -1 || c2 < l2)) { e3 = c2; k3 = 0; }
            else if (l2 !== -1) { e3 = l2; k3 = 1; }
            else { e3 = n; k3 = 2; }
            if (r2 !== -1 && r2 < e3 && !(k3 === 1 && r2 === e3 - 1)) {
              if (r2 > pos) { v += text.slice(pos, r2); kept += r2 - pos; }
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              pos = r2 + 1;
              continue;
            }
            if (k3 === 0) { v += text.slice(pos, e3); kept += e3 - pos; pos = e3 + 1; e2 = 0; }
            else if (k3 === 1) {
              if (e3 > pos && text.charCodeAt(e3 - 1) === 13) { v += text.slice(pos, e3 - 1); kept += e3 - 1 - pos; }
              else { v += text.slice(pos, e3); kept += e3 - pos; }
              pos = e3 + 1; line += 1; e2 = 1;
            } else { v += text.slice(pos); kept += n - pos; pos = n; e2 = 2; }
            break;
          }
          value = v;
          ended = e2;
          if (junkCheck && kept > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
      }

      fields.push(value);
      if (ended !== 0) break fieldLoop;
    }
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue recordLoop;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue recordLoop;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
