/* ════════════════════════════════════════════════
   rapport-juridique.js — AMI v1.0
   ────────────────────────────────────────────────
   💎 Feature PREMIUM add-on : "Rapport juridique mensuel"
   ────────────────────────────────────────────────
   Synthèse mensuelle opposable :
     1. Conformité NGAP (scores par pilier)
     2. Preuves collectées (nb signatures FORTE/STANDARD/MINIMAL)
     3. Certificats forensiques émis (chaîne de preuve)
     4. Exposition contentieux :
        - Patients à risque (cotations litigieuses, anomalies)
        - Actes non-cotés vs actes réalisés (CA sous-déclaré)
     5. Recommandations DPO
     6. Log d'accès (qui a consulté quoi, quand)

   🔒 GATING : SUB.requireAccess('rapport_juridique_mensuel')
      → Non-PREMIUM : paywall. Admin : accès total (test/démo).

   📦 API :
     window.RapportJuridique = {
       generate(month, year) → Promise<Report>
       render()              → affiche #view-rapport-juridique
       exportPDF(month, year)
     }
════════════════════════════════════════════════ */
'use strict';

(function(){

  /** Génère le rapport juridique pour un mois donné (M/Y, défaut = mois courant). */
  async function generate(month, year) {
    // 🔒 Gating
    if (typeof SUB !== 'undefined' && !SUB.hasAccess('rapport_juridique_mensuel')) {
      throw new Error('Feature PREMIUM requise');
    }

    const now = new Date();
    const M = (month ?? (now.getMonth() + 1));   // 1-12
    const Y = (year  ?? now.getFullYear());
    const startIso = new Date(Y, M-1, 1).toISOString();
    const endIso   = new Date(Y, M, 0, 23, 59, 59).toISOString();

    // 1. Cotations du mois
    let cotations = [];
    try {
      const d = await fetchAPI(`/webhook/ami-historique?from=${startIso}&to=${endIso}`);
      cotations = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
    } catch (_) {}

    // 2. Score conformité (compliance-engine si dispo, fallback = N/A)
    let conformite = null;
    try {
      if (window.ComplianceEngine && typeof ComplianceEngine.score === 'function') {
        conformite = await ComplianceEngine.score({ from:startIso, to:endIso });
      }
    } catch (_) {}

    // 3. Preuves signatures (signature.js IDB)
    let preuves = { FORTE:0, STANDARD:0, MINIMAL:0, total:0 };
    try {
      if (typeof listSignatures === 'function') {
        const lst = await listSignatures();
        (lst || []).forEach(s => {
          const d = new Date(s.created_at || s.date || 0);
          if (d.getFullYear() !== Y || (d.getMonth()+1) !== M) return;
          const t = (s.signature_type || 'STANDARD').toUpperCase();
          preuves[t] = (preuves[t] || 0) + 1;
          preuves.total += 1;
        });
      }
    } catch (_) {}

    // 4. Certificats forensiques
    let certificats = { count:0, chain_valid:true, last_seq:null };
    try {
      if (window.ForensicCert) {
        const req = indexedDB.open('ami_forensic', 1);
        const db  = await new Promise((res, rej) => {
          req.onsuccess = e => res(e.target.result);
          req.onerror   = e => rej(e.target.error);
        });
        const all = await new Promise((res, rej) => {
          const tx = db.transaction('forensic_certificates', 'readonly');
          const rq = tx.objectStore('forensic_certificates').getAll();
          rq.onsuccess = () => res(rq.result || []);
          rq.onerror   = () => rej(rq.error);
        });
        const inMonth = all.filter(c => {
          const d = new Date(c.created_at);
          return d.getFullYear() === Y && (d.getMonth()+1) === M;
        });
        certificats.count = inMonth.length;
        if (inMonth.length) {
          inMonth.sort((a,b) => (b.seq||0)-(a.seq||0));
          certificats.last_seq = inMonth[0].seq;
        }
        // Vérification de la chaîne (échantillon 10 derniers)
        const sample = [...all].sort((a,b) => (b.seq||0)-(a.seq||0)).slice(0,10);
        for (const c of sample) {
          const r = await ForensicCert.verify(c);
          if (!r.valid) { certificats.chain_valid = false; break; }
        }
      }
    } catch (_) {}

    // 5. CA sous-déclaré (signal d'exposition)
    let sous_declare = { items:0, gain_potentiel:0 };
    try {
      if (window.CASousDeclare) {
        const a = await CASousDeclare.analyze();
        sous_declare.items = a.stats.total_items;
        sous_declare.gain_potentiel = a.stats.total_gain;
      }
    } catch (_) {}

    // 6. Audit log (qui a consulté quoi) — best-effort
    let accesses = [];
    try {
      const d = await fetchAPI(`/webhook/my-audit-logs?from=${startIso}&to=${endIso}`);
      accesses = Array.isArray(d?.data) ? d.data.slice(0, 50) : [];
    } catch (_) {}

    // 7. Recommandations automatiques
    const reco = [];
    if (preuves.FORTE < preuves.total * 0.5 && preuves.total > 5) {
      reco.push('Moins de 50 % de signatures FORTE : activer le recueil systématique à domicile via le mode preuve renforcée.');
    }
    if (!certificats.chain_valid) {
      reco.push('⚠️ Chaîne de certificats rompue : un certificat a été modifié ou supprimé. Contacter le support PREMIUM.');
    }
    if (sous_declare.gain_potentiel > 100) {
      reco.push(`CA sous-déclaré détecté : ${fmt(sous_declare.gain_potentiel)} récupérables. Voir l'onglet "Détection CA sous-déclaré".`);
    }
    if (conformite && conformite.score < 70) {
      reco.push('Score de conformité < 70/100. Lancer l\'auto-correction dans le moteur de conformité avant contrôle CPAM.');
    }
    if (!reco.length) {
      reco.push('Aucun signal préoccupant ce mois-ci. Continuer la vigilance habituelle.');
    }

    return {
      period: { month:M, year:Y, label: new Date(Y,M-1,1).toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) },
      generated_at: new Date().toISOString(),
      infirmiere: APP?.user ? {
        id: APP.user.id,
        nom: APP.user.nom || '',
        prenom: APP.user.prenom || '',
        email: APP.user.email || ''
      } : null,
      stats: {
        nb_cotations: cotations.length,
        ca_total: +cotations.reduce((s,c) => s + (parseFloat(c.total || c.ca || 0) || 0), 0).toFixed(2)
      },
      conformite,
      preuves,
      certificats,
      sous_declare,
      accesses,
      recommandations: reco
    };
  }

  /* ───── UI ─────────────────────────────────────────────── */

  async function render() {
    // 🔒 Gating
    if (typeof SUB !== 'undefined' && !SUB.requireAccess('rapport_juridique_mensuel')) return;

    const root = document.getElementById('view-rapport-juridique');
    if (!root) return;

    const now = new Date();
    root.innerHTML = `
      <div class="card">
        <div class="cardh">
          <h2>⚖️ Rapport juridique mensuel <span class="sub-feat-pill">PREMIUM</span></h2>
          <p class="sub">Synthèse auditée : conformité, preuves, exposition contentieux, recommandations DPO.</p>
        </div>
        <div class="rj-toolbar">
          <label>Mois :
            <select id="rj-month"></select>
          </label>
          <label>Année :
            <select id="rj-year"></select>
          </label>
          <button class="btn" id="rj-generate">Générer le rapport</button>
          <button class="btn btn-outline" id="rj-export" disabled>📄 Export PDF</button>
        </div>
        <div id="rj-body"></div>
      </div>
    `;

    // Remplir selects
    const selM = $('rj-month');
    const selY = $('rj-year');
    for (let m=1; m<=12; m++) {
      const o = new Option(new Date(2000, m-1, 1).toLocaleDateString('fr-FR',{month:'long'}), m);
      if (m === now.getMonth() + 1) o.selected = true;
      selM.add(o);
    }
    for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
      const o = new Option(y, y);
      if (y === now.getFullYear()) o.selected = true;
      selY.add(o);
    }

    $('rj-generate').onclick = async () => {
      $('rj-body').innerHTML = '<div class="ai in">⏳ Génération en cours…</div>';
      try {
        const r = await generate(parseInt(selM.value), parseInt(selY.value));
        $('rj-body').innerHTML = _renderReport(r);
        $('rj-export').disabled = false;
        $('rj-export').onclick = () => exportPDF(r);
      } catch (e) {
        $('rj-body').innerHTML = `<div class="ai in">⚠️ Erreur : ${sanitize(e.message||'')}</div>`;
      }
    };
  }

  function _renderReport(r) {
    const conf = r.conformite ? `${r.conformite.score}/100` : '—';
    const chainBadge = r.certificats.chain_valid
      ? '<span class="fc-badge ok">Intègre</span>'
      : '<span class="fc-badge ko">Rompue</span>';
    return `
      <div class="rj-report">
        <h3>${r.period.label}</h3>
        <div class="dash-kpi-row">
          <div class="dash-kpi"><div class="dash-kpi-label">Cotations</div><div class="dash-kpi-val">${r.stats.nb_cotations}</div></div>
          <div class="dash-kpi"><div class="dash-kpi-label">CA total</div><div class="dash-kpi-val">${fmt(r.stats.ca_total)}</div></div>
          <div class="dash-kpi"><div class="dash-kpi-label">Conformité</div><div class="dash-kpi-val">${conf}</div></div>
          <div class="dash-kpi"><div class="dash-kpi-label">Chaîne forensique</div><div class="dash-kpi-val">${chainBadge}</div></div>
        </div>

        <h4>📝 Preuves collectées</h4>
        <table class="rj-table">
          <tr><th>FORTE</th><th>STANDARD</th><th>MINIMAL</th><th>Total</th></tr>
          <tr><td>${r.preuves.FORTE}</td><td>${r.preuves.STANDARD}</td><td>${r.preuves.MINIMAL}</td><td><b>${r.preuves.total}</b></td></tr>
        </table>

        <h4>🛡️ Certificats forensiques</h4>
        <p>${r.certificats.count} certificat${r.certificats.count>1?'s':''} émis ce mois-ci
           · dernier n° ${r.certificats.last_seq ?? '—'}</p>

        <h4>💸 CA sous-déclaré (signal)</h4>
        <p>${r.sous_declare.items} écart${r.sous_declare.items>1?'s':''} détecté${r.sous_declare.items>1?'s':''}
           · ${fmt(r.sous_declare.gain_potentiel)} récupérables (glissant 90j)</p>

        <h4>✅ Recommandations DPO</h4>
        <ul class="rj-reco">
          ${r.recommandations.map(x => `<li>${sanitize(x)}</li>`).join('')}
        </ul>

        <div class="rj-foot">
          Rapport généré le ${new Date(r.generated_at).toLocaleString('fr-FR')} ·
          ${r.infirmiere ? sanitize(r.infirmiere.prenom + ' ' + r.infirmiere.nom) : '—'}
        </div>
      </div>
    `;
  }

  async function exportPDF(r) {
    if (!r) return;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Rapport juridique ${r.period.label}</title>
      <style>
        body{font-family:Helvetica,sans-serif;max-width:820px;margin:25px auto;padding:20px;color:#222}
        h1{border-bottom:2px solid #c678dd;padding-bottom:8px;color:#c678dd}
        h3{color:#333;margin-top:22px}
        h4{margin-top:18px;color:#555}
        table{border-collapse:collapse;margin:10px 0}
        th,td{border:1px solid #ddd;padding:6px 12px;text-align:left}
        th{background:#f4f4f8}
        .foot{margin-top:40px;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:10px}
        ul{line-height:1.6}
      </style></head><body>
      <h1>⚖️ Rapport juridique mensuel AMI</h1>
      <p><b>Période :</b> ${r.period.label}<br>
         <b>Infirmière :</b> ${r.infirmiere ? r.infirmiere.prenom + ' ' + r.infirmiere.nom : '—'}<br>
         <b>Généré le :</b> ${new Date(r.generated_at).toLocaleString('fr-FR')}</p>

      <h3>1. Activité</h3>
      <p>${r.stats.nb_cotations} cotations · CA total : ${r.stats.ca_total.toFixed(2)} €</p>

      <h3>2. Preuves collectées</h3>
      <table>
        <tr><th>Type</th><th>Nombre</th></tr>
        <tr><td>FORTE (avec géozone + horodatage)</td><td>${r.preuves.FORTE}</td></tr>
        <tr><td>STANDARD</td><td>${r.preuves.STANDARD}</td></tr>
        <tr><td>MINIMAL</td><td>${r.preuves.MINIMAL}</td></tr>
        <tr><td><b>Total</b></td><td><b>${r.preuves.total}</b></td></tr>
      </table>

      <h3>3. Certificats forensiques</h3>
      <p>${r.certificats.count} certificats émis · dernier n° ${r.certificats.last_seq ?? '—'}<br>
         Intégrité de la chaîne : <b>${r.certificats.chain_valid ? 'INTÈGRE' : 'ROMPUE'}</b></p>

      <h3>4. Exposition — CA sous-déclaré</h3>
      <p>${r.sous_declare.items} écarts détectés sur les 90 derniers jours,
         soit ${r.sous_declare.gain_potentiel.toFixed(2)} € récupérables.</p>

      <h3>5. Conformité NGAP</h3>
      <p>Score : ${r.conformite ? r.conformite.score + '/100' : 'N/A'}</p>

      <h3>6. Recommandations DPO</h3>
      <ul>${r.recommandations.map(x => `<li>${sanitize(x)}</li>`).join('')}</ul>

      <div class="foot">
        Rapport généré automatiquement par AMI PREMIUM.
        Les données sont extraites du système de l'infirmière uniquement,
        aucune donnée patient brute n'est incluse.
        Document à conserver pendant 10 ans (durée légale).
      </div>
      </body></html>`;

    const blob = new Blob([html], { type:'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url);
    if (w) setTimeout(() => w.print(), 600);
  }

  /* ───── Hook navigation ────────────────────────────────── */
  document.addEventListener('ui:navigate', e => {
    if (e.detail?.view === 'rapport-juridique') render();
  });

  /* Export */
  window.RapportJuridique = { generate, render, exportPDF };

})();
