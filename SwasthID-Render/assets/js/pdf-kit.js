/* PDF building blocks for the emergency card and the health summary.
   Text is set in Helvetica when it can be encoded. Anything else (names in
   Hindi or Bengali, ₹) is drawn by the browser onto a canvas and placed as an
   image, so every script is shaped correctly without downloading a font. */
const SwasthPdf = (() => {
  const C = {
    text: [15, 30, 38], text2: [62, 82, 92], text3: [85, 106, 114],
    border: [211, 224, 229], soft: [238, 246, 248],
    brand: [5, 102, 141], brandSoft: [221, 238, 244],
    danger: [180, 35, 24], dangerSoft: [251, 237, 236], white: [255, 255, 255]
  };
  const PT = 0.3528;          // mm per point
  const PX_PER_MM = 12;       // canvas resolution for non-Latin text (~300 dpi)
  const ENCODABLE = /^[\x20-\x7E\xA0-\xFF–—‘’“”•…]*$/;
  const CANVAS_FONT = '"Lexend", "Noto Sans", "Noto Sans Devanagari", "Noto Sans Bengali", "Nirmala UI", system-ui, sans-serif';

  // "2026-08-02" is a calendar date, not midnight UTC, so read it as local.
  function toDate(v) {
    if (!v) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(v, withYear = true) {
    const d = toDate(v);
    if (!d) return v ? String(v) : '';
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return `${d.getDate()} ${month}${withYear ? ' ' + d.getFullYear() : ''}`;
  }
  function ageFrom(dob) {
    const d = toDate(dob); if (!d) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
    return a >= 0 && a < 130 ? a : null;
  }
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

  function create(jsPDF, { header, footer } = {}) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const W = 210, H = 297, M = 16, TOP = 16, BOTTOM = 18;
    const measureCtx = document.createElement('canvas').getContext('2d');
    const canvasFont = (size, bold) => `${bold ? 600 : 400} ${size * PT * PX_PER_MM}px ${CANVAS_FONT}`;
    const api = { doc, C, W, H, M, CW: W - 2 * M, y: TOP, top: TOP };

    api.setFont = (size, bold = false, color = C.text) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    };
    api.width = (str, size, bold = false) => {
      str = clean(str);
      if (ENCODABLE.test(str)) { api.setFont(size, bold); return doc.getTextWidth(str); }
      measureCtx.font = canvasFont(size, bold); return measureCtx.measureText(str).width / PX_PER_MM;
    };
    // Split into lines that fit maxW. Long single words are broken.
    api.wrap = (str, size, bold, maxW) => {
      str = clean(str); if (!str) return [];
      if (!maxW) return [str];
      if (ENCODABLE.test(str)) { api.setFont(size, bold); return doc.splitTextToSize(str, maxW); }
      const out = []; let line = '';
      for (const word of str.split(' ')) {
        const next = line ? line + ' ' + word : word;
        if (api.width(next, size, bold) <= maxW) { line = next; continue; }
        if (line) out.push(line);
        line = word;
        while (api.width(line, size, bold) > maxW && line.length > 1) {
          let cut = line.length - 1; while (cut > 1 && api.width(line.slice(0, cut), size, bold) > maxW) cut--;
          out.push(line.slice(0, cut)); line = line.slice(cut);
        }
      }
      if (line) out.push(line);
      return out;
    };
    function drawLine(str, x, y, size, bold, color, align) {
      if (ENCODABLE.test(str)) { api.setFont(size, bold, color); doc.text(str, x, y, { align }); return; }
      const fontMm = size * PT, w = api.width(str, size, bold);
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(w * PX_PER_MM) + 4; cv.height = Math.ceil(fontMm * 1.5 * PX_PER_MM);
      const ctx = cv.getContext('2d');
      ctx.font = canvasFont(size, bold); ctx.fillStyle = `rgb(${color.join(',')})`; ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, 0, fontMm * 1.1 * PX_PER_MM);
      const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      doc.addImage(cv.toDataURL('image/png'), 'PNG', left, y - fontMm * 1.1, cv.width / PX_PER_MM, cv.height / PX_PER_MM);
    }
    // Draw text with its first baseline at y. Returns the height used.
    api.text = (str, x, y, { size = 10, bold = false, color = C.text, maxW = null, align = 'left', lh = 1.4, maxLines = 0 } = {}) => {
      let lines = api.wrap(str, size, bold, maxW);
      if (maxLines && lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        let last = lines[maxLines - 1];
        while (last.length > 1 && api.width(last + '…', size, bold) > (maxW || Infinity)) last = last.slice(0, -1);
        lines[maxLines - 1] = last.replace(/[\s,;·]+$/, '') + '…';
      }
      const step = size * PT * lh;
      lines.forEach((l, i) => drawLine(l, x, y + i * step, size, bold, color, align));
      return lines.length ? (lines.length - 1) * step + size * PT : 0;
    };
    api.textHeight = (str, { size = 10, bold = false, maxW = null, lh = 1.4 } = {}) => {
      const n = api.wrap(str, size, bold, maxW).length; return n ? (n - 1) * size * PT * lh + size * PT : 0;
    };

    api.logo = (x, y, s = 7) => {
      doc.setFillColor(...C.brand); doc.roundedRect(x, y, s, s, s * 0.25, s * 0.25, 'F');
      doc.setDrawColor(...C.white); doc.setLineWidth(s * 0.1); doc.setLineCap('round');
      doc.line(x + s / 2, y + s * 0.28, x + s / 2, y + s * 0.72); doc.line(x + s * 0.28, y + s / 2, x + s * 0.72, y + s / 2);
      doc.setLineCap('butt'); doc.setLineWidth(0.2);
    };
    api.rule = (y, color = C.border) => { doc.setDrawColor(...color); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); };

    api.newPage = () => { doc.addPage(); api.y = TOP; header?.(api, false); };
    api.ensure = need => { if (api.y + need > H - BOTTOM) { api.newPage(); return true; } return false; };

    api.section = title => {
      api.ensure(22);
      api.y += 4;
      api.text(title, M, api.y + 4, { size: 11.5, bold: true });
      api.y += 7.5;
    };
    api.note = str => {
      api.ensure(8);
      const h = api.text(str, M, api.y + 3.2, { size: 9.5, color: C.text2, maxW: api.CW });
      api.y += h + 3;
    };

    // Simple table: header row, rows separated by hairlines, cells wrap.
    // cols: [{ label, w (fraction of width), bold }]
    api.table = (cols, rows, { size = 9.5 } = {}) => {
      const pad = 2, widths = cols.map(c => c.w * api.CW);
      const drawHead = () => {
        let x = M;
        cols.forEach((c, i) => { api.text(c.label.toUpperCase(), x, api.y + 3, { size: 7, bold: true, color: C.text3 }); x += widths[i]; });
        api.y += 5; api.rule(api.y);
      };
      drawHead();
      rows.forEach(row => {
        const hs = row.map((cell, i) => api.textHeight(cell, { size, bold: cols[i].bold, maxW: widths[i] - pad * 2 }));
        const h = Math.max(...hs) + pad * 2 + 0.6;
        if (api.ensure(h + 2)) drawHead();
        let x = M;
        row.forEach((cell, i) => {
          api.text(cell, x, api.y + pad + size * PT * 0.9, { size, bold: cols[i].bold, color: cols[i].color || C.text, maxW: widths[i] - pad * 2 });
          x += widths[i];
        });
        api.y += h; api.rule(api.y);
      });
      api.y += 2;
    };

    // Two-column label/value list, empty values skipped.
    api.facts = (pairs) => {
      const items = pairs.filter(([, v]) => clean(v));
      if (!items.length) return;
      const colW = api.CW / 2;
      for (let i = 0; i < items.length; i += 2) {
        const pair = items.slice(i, i + 2);
        const h = Math.max(...pair.map(([, v]) => api.textHeight(v, { size: 10, maxW: colW - 4 }))) + 5;
        api.ensure(h + 2);
        pair.forEach(([label, value], j) => {
          const x = M + j * colW;
          api.text(label.toUpperCase(), x, api.y + 2.6, { size: 7, bold: true, color: C.text3 });
          api.text(value, x, api.y + 7, { size: 10, maxW: colW - 4 });
        });
        api.y += h + 3;
      }
    };

    // Red box for drug allergies; neutral when there are none.
    api.allergyBox = (drug, other) => {
      const has = !!clean(drug);
      const body = has ? clean(drug) : 'No known drug allergies';
      const bodyH = api.textHeight(body, { size: has ? 13 : 11, bold: has, maxW: api.CW - 10 });
      const otherLine = clean(other) ? `Other allergies: ${clean(other)}` : '';
      const otherH = otherLine ? api.textHeight(otherLine, { size: 9, maxW: api.CW - 10 }) + 2.5 : 0;
      const h = 9 + bodyH + otherH + 4;
      api.ensure(h + 4);
      doc.setFillColor(...(has ? C.dangerSoft : C.soft)); doc.setDrawColor(...(has ? C.danger : C.border)); doc.setLineWidth(has ? 0.5 : 0.2);
      doc.roundedRect(M, api.y, api.CW, h, 2, 2, 'FD'); doc.setLineWidth(0.2);
      api.text('DRUG ALLERGIES', M + 5, api.y + 6, { size: 7.5, bold: true, color: has ? C.danger : C.text3 });
      api.text(body, M + 5, api.y + 11.5, { size: has ? 13 : 11, bold: has, color: has ? C.danger : C.text, maxW: api.CW - 10 });
      if (otherLine) api.text(otherLine, M + 5, api.y + 11.5 + bodyH + 2.5, { size: 9, color: C.text2, maxW: api.CW - 10 });
      api.y += h + 5;
    };

    api.finish = () => {
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) { doc.setPage(i); footer?.(api, i, n); }
      return doc;
    };
    header?.(api, true);
    return api;
  }

  function save(doc, filename) {
    const blob = doc.output('blob');
    if (!blob || !blob.size) throw new Error('The generated PDF was empty.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const fileSafe = v => String(v || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

  return { C, create, save, fmtDate, toDate, ageFrom, clean, fileSafe };
})();
