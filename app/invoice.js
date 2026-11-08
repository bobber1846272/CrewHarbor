/* CrewHarbor · factuur als PDF (in de browser gemaakt met jsPDF) — gebruikt in de app én in Beheer */
(function () {
  'use strict';
  function loadJsPdf() {
    if (window.jspdf) return Promise.resolve();
    return new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js';
      s.onload = ok; s.onerror = () => bad(new Error('De PDF-maker kon niet laden. Controleer je verbinding.'));
      document.head.appendChild(s);
    });
  }
  const eur = c => '€ ' + (Math.round(c || 0) / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = v => { if (!v) return ''; const x = new Date(String(v).slice(0, 10) + 'T12:00'); return x.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }); };

  const ds = v => v ? String(v).slice(8, 10) + '-' + String(v).slice(5, 7) + '-' + String(v).slice(0, 4) : '';
  async function makePdf(inv) {
    await loadJsPdf();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const S = inv.seller || {}, C = inv.customer || {};
    const navy = [13, 35, 64], muted = [74, 95, 110], accent = [29, 110, 123];
    let y = 22;
    // kop
    doc.setFillColor(...navy); doc.rect(0, 0, 210, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...navy); doc.text('FACTUUR', 20, y + 4);
    doc.setFontSize(12); doc.text(S.name || 'CrewHarbor', 190, y, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...muted);
    const sLines = [S.address, [S.postcode, S.city].filter(Boolean).join('  '), S.country, S.email, S.phone, S.website].filter(Boolean);
    sLines.forEach((l, i) => doc.text(String(l), 190, y + 5 + i * 4.2, { align: 'right' }));
    y = Math.max(y + 12, y + 5 + sLines.length * 4.2) + 8;
    // klant + factuurgegevens
    doc.setFontSize(8); doc.setTextColor(...accent); doc.setFont('helvetica', 'bold'); doc.text('FACTUUR AAN', 20, y);
    doc.text('GEGEVENS', 120, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...navy);
    const cLines = [C.name, C.attn ? 't.a.v. ' + C.attn : '', C.address, [C.postcode, C.city].filter(Boolean).join('  '), C.vat ? 'Btw-nr: ' + C.vat : ''].filter(Boolean);
    cLines.forEach((l, i) => doc.text(String(l), 20, y + 6 + i * 5));
    const meta = [['Factuurnummer', inv.number], ['Factuurdatum', d(inv.issuedOn)], ['Vervaldatum', d(inv.dueOn)], ['Periode', ds(inv.periodFrom) + ' t/m ' + ds(inv.periodTo)]];
    if (C.reference) meta.push(['Uw referentie', C.reference]);
    meta.forEach((m, i) => { doc.setTextColor(...muted); doc.text(m[0], 120, y + 6 + i * 5); doc.setTextColor(...navy); doc.text(String(m[1] || ''), 190, y + 6 + i * 5, { align: 'right' }); });
    y += 8 + Math.max(cLines.length, meta.length) * 5 + 8;
    // regels
    doc.setFillColor(237, 242, 243); doc.rect(20, y - 5, 170, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...navy);
    doc.text('Omschrijving', 23, y); doc.text('Aantal', 140, y, { align: 'right' }); doc.text('Bedrag', 187, y, { align: 'right' });
    doc.setFont('helvetica', 'normal'); y += 9;
    (inv.lines || []).forEach(l => {
      const wrapped = doc.splitTextToSize(String(l.description || ''), 105);
      doc.setFontSize(10); doc.setTextColor(...navy); doc.text(wrapped, 23, y);
      doc.text(String(l.qty || 1), 140, y, { align: 'right' }); doc.text(eur(l.totalCents), 187, y, { align: 'right' });
      y += wrapped.length * 5;
      if (l.detail) { doc.setFontSize(8.5); doc.setTextColor(...muted); doc.text(String(l.detail), 23, y); y += 5; }
      y += 3; doc.setDrawColor(216, 225, 227); doc.line(20, y - 2, 190, y - 2);
    });
    // totalen
    y += 4;
    const tot = [['Subtotaal', eur(inv.subtotalCents)], ['Btw ' + String(inv.vatPct).replace(/\.0+$/, '').replace('.', ',') + '%', eur(inv.vatCents)]];
    doc.setFontSize(10);
    tot.forEach(t => { doc.setTextColor(...muted); doc.text(t[0], 140, y); doc.setTextColor(...navy); doc.text(t[1], 187, y, { align: 'right' }); y += 6; });
    doc.setFillColor(...navy); doc.rect(130, y - 4, 60, 10, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Totaal', 134, y + 2.5); doc.text(eur(inv.totalCents), 187, y + 2.5, { align: 'right' });
    y += 18;
    // betalen
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...navy);
    const paid = inv.status === 'betaald';
    const pay = paid ? ['Deze factuur is betaald' + (inv.paidAt ? ' op ' + d(inv.paidAt) : '') + '. Dank je wel!']
      : ['Graag het totaalbedrag van ' + eur(inv.totalCents) + ' voor ' + d(inv.dueOn) + ' overmaken naar:',
        'IBAN ' + (S.iban || '') + (S.bic ? '  ·  BIC ' + S.bic : '') + '  ·  t.n.v. ' + (S.name || ''), 'Onder vermelding van ' + inv.number + '.'];
    pay.forEach((l, i) => doc.text(l, 20, y + i * 5.5));
    if (inv.status === 'geannuleerd') { doc.setTextColor(179, 38, 30); doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.text('GEANNULEERD', 105, 150, { align: 'center', angle: 20 }); }
    // voet
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...muted);
    const foot = [S.name, S.kvk ? 'KvK ' + S.kvk : '', S.vat ? 'Btw ' + S.vat : '', S.iban ? 'IBAN ' + S.iban : ''].filter(Boolean).join('  ·  ');
    doc.text(foot, 105, 284, { align: 'center' });
    if (S.footer) doc.text(doc.splitTextToSize(String(S.footer), 170), 105, 279, { align: 'center' });
    return doc;
  }
  window.CH_INVOICE = {
    make: makePdf,
    async download(inv) { const doc = await makePdf(inv); doc.save('factuur-' + inv.number + '.pdf'); },
    async open(inv) { const doc = await makePdf(inv); const url = doc.output('bloburl'); const w = window.open(url, '_blank'); if (!w) doc.save('factuur-' + inv.number + '.pdf'); }
  };
})();
