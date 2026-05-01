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

    // 3. Preuves signatures — utilise le helper exposé par signature.js
    //    (la DB réelle est nommée dynamiquement ami_sig_db_<userId> et ne peut
    //    pas être ouverte par un nom statique)
    let preuves = { FORTE:0, STANDARD:0, MINIMAL:0, total:0 };
    try {
      let allSigs = [];
      if (typeof window.getAllSignatures === 'function') {
        allSigs = await window.getAllSignatures();
      } else if (indexedDB.databases) {
        // Fallback : énumérer les bases pour trouver ami_sig_db_*
        const dbs = await indexedDB.databases();
        const sigDbName = (dbs || []).map(d => d.name).find(n => n && n.startsWith('ami_sig_db_'));
        if (sigDbName) {
          const sigDb = await new Promise((res, rej) => {
            const req = indexedDB.open(sigDbName, 1);
            req.onsuccess = e => res(e.target.result);
            req.onerror   = e => rej(e.target.error);
          });
          allSigs = await new Promise((res, rej) => {
            const tx = sigDb.transaction('ami_signatures', 'readonly');
            const rq = tx.objectStore('ami_signatures').getAll();
            rq.onsuccess = () => res(rq.result || []);
            rq.onerror   = () => rej(rq.error);
          });
        }
      }
      // Exclure la signature IDE auto-injectée.
      // ⚠️ Source de vérité : window.IDE_SELF_SIG_ID exposé par signature.js.
      //    Avant le 2026-05-01 ce filtre cherchait 'ide_self_signature' qui
      //    n'a jamais existé → la sig IDE était comptée comme une preuve
      //    patient (faussant les compteurs FORTE/STANDARD/MINIMAL).
      const IDE_SELF_SIG_ID = (typeof window !== 'undefined' && window.IDE_SELF_SIG_ID) || '__ide_self__';
      const lst = (allSigs || []).filter(s => s.invoice_id !== IDE_SELF_SIG_ID);
      lst.forEach(s => {
        const d = new Date(s.signed_at || s.created_at || s.date || 0);
        if (d.getFullYear() !== Y || (d.getMonth()+1) !== M) return;
        // Détecter le niveau de force probante : FORTE si geozone+hash, STANDARD si hash, MINIMAL sinon
        let t = (s.signature_type || '').toUpperCase();
        if (!t) {
          if (s.geozone && s.signature_hash) t = 'FORTE';
          else if (s.signature_hash)         t = 'STANDARD';
          else                                t = 'MINIMAL';
        }
        if (!['FORTE','STANDARD','MINIMAL'].includes(t)) t = 'STANDARD';
        preuves[t] = (preuves[t] || 0) + 1;
        preuves.total += 1;
      });
    } catch (e) {
      console.warn('[RapportJuridique] lecture signatures KO:', e.message);
    }

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
      infirmiere: (typeof S !== 'undefined' && S?.user) ? {
        id: S.user.id,
        nom: S.user.nom || '',
        prenom: S.user.prenom || '',
        email: S.user.email || ''
      } : (typeof APP !== 'undefined' && APP?.user) ? {
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

  /* ───── UI — CSS auto-injecté ──────────────────────────── */
  function _injectRJStyles() {
    if (document.getElementById('rj-injected-styles')) return;
    const css = `
.rj-toolbar { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-top:14px;
              padding:14px; background:var(--s); border:1px solid var(--b); border-radius:12px; }
.rj-toolbar label { display:flex; flex-direction:column; gap:4px; font-size:11px; color:var(--m);
                    font-family:var(--fm); text-transform:uppercase; letter-spacing:.5px; min-width:140px; }
.rj-toolbar select { padding:8px 12px; background:var(--c); color:var(--t); border:1px solid var(--b);
                     border-radius:8px; font-size:13px; font-family:var(--ff); cursor:pointer; }
.rj-toolbar select:hover, .rj-toolbar select:focus { border-color:var(--a); outline:none; }
.rj-toolbar .rj-actions { display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; }
.rj-toolbar .rj-btn-primary {
  padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; font-family:var(--ff);
  background:linear-gradient(135deg,var(--a),#00b891); color:#000; border:1px solid transparent;
  border-radius:10px; box-shadow:0 4px 14px rgba(0,212,170,.25); transition:all .15s;
}
.rj-toolbar .rj-btn-primary:hover { transform:translateY(-1px); box-shadow:0 6px 22px rgba(0,212,170,.35); }
.rj-toolbar .rj-btn-secondary {
  padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer; font-family:var(--ff);
  background:var(--c); color:var(--t); border:1px solid var(--b); border-radius:10px; transition:all .15s;
}
.rj-toolbar .rj-btn-secondary:hover:not(:disabled) { border-color:var(--w); color:var(--w); }
.rj-toolbar .rj-btn-secondary:disabled { opacity:.4; cursor:not-allowed; }

.rj-body { margin-top:18px; }
.rj-body .rj-loading { padding:30px 20px; text-align:center; color:var(--m); font-size:14px; }

.rj-period-title { font-family:var(--fs,serif); font-size:24px; color:var(--a); margin:0 0 16px;
                   font-weight:400; }

/* KPI cards */
.rj-kpi-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:24px; }
.rj-kpi {
  padding:14px 16px; background:var(--s); border:1px solid var(--b); border-radius:12px;
  transition:all .15s;
}
.rj-kpi:hover { border-color:rgba(0,212,170,.4); transform:translateY(-1px); }
.rj-kpi-label { font-size:10px; color:var(--m); text-transform:uppercase; letter-spacing:.6px;
                font-family:var(--fm); margin-bottom:6px; font-weight:600; }
.rj-kpi-val { font-size:22px; font-weight:700; color:var(--t); font-family:var(--fs,serif); line-height:1.2; }
.rj-kpi-val .pct { font-size:14px; color:var(--m); font-family:var(--fm); margin-left:4px; }

/* Sections */
.rj-section { margin-bottom:22px; }
.rj-section-h { display:flex; align-items:center; gap:8px; margin:0 0 12px;
                font-family:var(--fs,serif); font-size:17px; font-weight:400; color:var(--t); }
.rj-section-h::before { content:''; width:3px; height:18px; background:var(--a); border-radius:2px; }

/* Tableau preuves */
.rj-table { width:100%; border-collapse:separate; border-spacing:0; background:var(--s);
            border:1px solid var(--b); border-radius:10px; overflow:hidden; }
.rj-table th, .rj-table td { padding:10px 14px; text-align:center; font-size:13px; }
.rj-table th { background:var(--c); color:var(--m); font-family:var(--fm); font-size:10px;
               text-transform:uppercase; letter-spacing:.6px; font-weight:700;
               border-bottom:1px solid var(--b); }
.rj-table td { color:var(--t); font-weight:600; font-family:var(--fm); }
.rj-table td.forte    { color:var(--ok); }
.rj-table td.standard { color:var(--a); }
.rj-table td.minimal  { color:var(--w); }
.rj-table td.total    { font-weight:800; font-size:15px; }

/* Mini info-cards */
.rj-info-card { padding:12px 14px; background:var(--s); border:1px solid var(--b); border-radius:10px;
                font-size:13px; color:var(--t); line-height:1.6; }
.rj-info-card strong { color:var(--a); }
.rj-info-card .badge-ok { display:inline-block; padding:2px 8px; background:rgba(0,212,170,.15);
                          color:var(--ok); border:1px solid rgba(0,212,170,.4); border-radius:50px;
                          font-size:11px; font-family:var(--fm); font-weight:700; margin-left:6px; }
.rj-info-card .badge-ko { display:inline-block; padding:2px 8px; background:rgba(255,95,109,.15);
                          color:var(--d); border:1px solid rgba(255,95,109,.4); border-radius:50px;
                          font-size:11px; font-family:var(--fm); font-weight:700; margin-left:6px; }

/* Recommandations */
.rj-reco { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px; }
.rj-reco li { padding:10px 14px; background:var(--s); border:1px solid var(--b); border-radius:10px;
              border-left:3px solid var(--a); font-size:13px; color:var(--t); line-height:1.5; }
.rj-reco li.warn { border-left-color:var(--w); background:linear-gradient(90deg,rgba(255,180,71,.04),var(--s)); }
.rj-reco li.crit { border-left-color:var(--d); background:linear-gradient(90deg,rgba(255,95,109,.04),var(--s)); }
.rj-reco li.ok   { border-left-color:var(--ok); background:linear-gradient(90deg,rgba(0,212,170,.04),var(--s)); }

/* Footer */
.rj-foot { margin-top:24px; padding:12px 14px; border-top:1px dashed var(--b);
           font-size:11px; color:var(--m); font-family:var(--fm); }
`;
    const style = document.createElement('style');
    style.id = 'rj-injected-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ───── UI ─────────────────────────────────────────────── */

  async function render() {
    // 🔒 Gating
    if (typeof SUB !== 'undefined' && !SUB.requireAccess('rapport_juridique_mensuel')) return;
    _injectRJStyles();

    // Cible : hub Outils pratiques (préféré) ou ancienne section view
    const root = document.getElementById('hub-host-rapport-juridique')
              || document.getElementById('view-rapport-juridique');
    if (!root) return;

    const now = new Date();
    root.innerHTML = `
      <div class="card">
        <div class="cardh">
          <h2>⚖️ Rapport juridique mensuel</h2>
          <p class="sub">Synthèse auditée : conformité, preuves, exposition contentieux, recommandations DPO.</p>
        </div>
        <div class="rj-toolbar">
          <label>Mois<select id="rj-month"></select></label>
          <label>Année<select id="rj-year"></select></label>
          <div class="rj-actions">
            <button class="rj-btn-primary"   data-action="generate">⚡ Générer le rapport</button>
            <button class="rj-btn-secondary" data-action="export" disabled>📄 Export PDF</button>
          </div>
        </div>
        <div id="rj-body" class="rj-body"></div>
      </div>
    `;

    // Remplir selects
    const selM = $('rj-month');
    const selY = $('rj-year');
    if (selM) {
      for (let m=1; m<=12; m++) {
        const o = new Option(new Date(2000, m-1, 1).toLocaleDateString('fr-FR',{month:'long'}), m);
        if (m === now.getMonth() + 1) o.selected = true;
        selM.add(o);
      }
    }
    if (selY) {
      for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
        const o = new Option(y, y);
        if (y === now.getFullYear()) o.selected = true;
        selY.add(o);
      }
    }

    /* ───── Délégation d'event sur le root (robuste au re-render) ───── */
    let _lastReport = null;
    if (!root._rjDelegated) {
      root._rjDelegated = true;
      root.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const body = document.getElementById('rj-body');
        const exportBtn = root.querySelector('button[data-action="export"]');
        try {
          if (action === 'generate') {
            if (body) body.innerHTML = '<div class="rj-loading">⏳ Génération en cours…</div>';
            const m = parseInt(($('rj-month') || {}).value || (new Date().getMonth()+1));
            const y = parseInt(($('rj-year')  || {}).value || new Date().getFullYear());
            const r = await generate(m, y);
            _lastReport = r;
            root._rjLastReport = r;
            if (body) body.innerHTML = _renderReport(r);
            if (exportBtn) exportBtn.disabled = false;
            return;
          }
          if (action === 'export') {
            const r = root._rjLastReport;
            if (!r) {
              alert('⚠️ Génère d\'abord un rapport avant l\'export PDF');
              return;
            }
            await exportPDF(r);
            return;
          }
        } catch (e) {
          if (body) body.innerHTML = `<div class="rj-info-card" style="border-color:rgba(255,95,109,.4);color:var(--d)">⚠️ Erreur : ${sanitize(e.message||'')}</div>`;
        }
      });
    }
  }

  function _renderReport(r) {
    const conf = r.conformite ? `${r.conformite.score}/100` : '—';
    const chainBadge = r.certificats.chain_valid
      ? '<span class="badge-ok">✓ Intègre</span>'
      : '<span class="badge-ko">✗ Rompue</span>';

    // Classification visuelle des recommandations selon mots-clés
    const recoItems = (r.recommandations || []).map(x => {
      const txt = sanitize(x);
      let cls = 'ok';
      if (/⚠️|rompue|critique|alerte|attention/i.test(x)) cls = 'crit';
      else if (/<\s*\d+|moins|inférieur|sous-déclaré|score/i.test(x) && !/aucun signal/i.test(x)) cls = 'warn';
      return `<li class="${cls}">${txt}</li>`;
    }).join('');

    const inf = r.infirmiere ? sanitize((r.infirmiere.prenom || '') + ' ' + (r.infirmiere.nom || '')).trim() : '—';

    return `
      <h3 class="rj-period-title">${r.period.label}</h3>

      <div class="rj-kpi-row">
        <div class="rj-kpi"><div class="rj-kpi-label">Cotations</div><div class="rj-kpi-val">${r.stats.nb_cotations}</div></div>
        <div class="rj-kpi"><div class="rj-kpi-label">CA total</div><div class="rj-kpi-val">${fmt(r.stats.ca_total)}</div></div>
        <div class="rj-kpi"><div class="rj-kpi-label">Conformité</div><div class="rj-kpi-val">${conf}</div></div>
        <div class="rj-kpi"><div class="rj-kpi-label">Chaîne forensique</div><div class="rj-kpi-val" style="font-size:14px">${chainBadge}</div></div>
      </div>

      <div class="rj-section">
        <h4 class="rj-section-h">📝 Preuves collectées</h4>
        <table class="rj-table">
          <tr><th>FORTE</th><th>STANDARD</th><th>MINIMAL</th><th>Total</th></tr>
          <tr>
            <td class="forte">${r.preuves.FORTE}</td>
            <td class="standard">${r.preuves.STANDARD}</td>
            <td class="minimal">${r.preuves.MINIMAL}</td>
            <td class="total">${r.preuves.total}</td>
          </tr>
        </table>
      </div>

      <div class="rj-section">
        <h4 class="rj-section-h">🛡️ Certificats forensiques</h4>
        <div class="rj-info-card">
          <strong>${r.certificats.count}</strong> certificat${r.certificats.count>1?'s':''} émis ce mois-ci ·
          dernier n° <strong>${r.certificats.last_seq ?? '—'}</strong>
          ${chainBadge}
        </div>
      </div>

      <div class="rj-section">
        <h4 class="rj-section-h">💸 CA sous-déclaré (signal)</h4>
        <div class="rj-info-card">
          <strong>${r.sous_declare.items}</strong> écart${r.sous_declare.items>1?'s':''} détecté${r.sous_declare.items>1?'s':''} ·
          <strong>${fmt(r.sous_declare.gain_potentiel)}</strong> récupérables
          <span style="color:var(--m);font-size:12px">(glissant 90j)</span>
        </div>
      </div>

      <div class="rj-section">
        <h4 class="rj-section-h">✅ Recommandations DPO</h4>
        <ul class="rj-reco">${recoItems}</ul>
      </div>

      <div class="rj-foot">
        Rapport généré le ${new Date(r.generated_at).toLocaleString('fr-FR')}
        ${inf && inf !== '—' ? '· ' + inf : ''}
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
    const w = window.open(url, '_blank');
    if (w) {
      setTimeout(() => { try { w.print(); } catch(_) {} }, 700);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_) {} }, 30000);
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport-juridique-${r.period.year}-${String(r.period.month).padStart(2,'0')}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_) {} }, 5000);
      if (typeof showToast === 'function') {
        showToast('📄 Rapport téléchargé (popup bloquée)', 's');
      }
    }
  }

  /* ───── Hook navigation ────────────────────────────────── */
  document.addEventListener('ui:navigate', e => {
    if (e.detail?.view === 'rapport-juridique') render();
  });
  // Hook hub-tab : déclenche le render quand on clique sur le sous-onglet du hub Outils
  document.addEventListener('ami:hub-tab', e => {
    if (e.detail?.hub === 'outils' && e.detail?.tab === 'rapport-juridique') render();
  });

  /* Export */
  window.RapportJuridique = { generate, render, exportPDF };

})();
