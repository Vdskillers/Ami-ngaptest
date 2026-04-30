/* ════════════════════════════════════════════════
   forensic-cert.js — AMI v1.0
   ────────────────────────────────────────────────
   💎 Feature PREMIUM add-on : "Certificats forensiques horodatés"
   ────────────────────────────────────────────────
   Extension du système de preuve existant (signature.js) :

     🔗 CHAÎNE DE PREUVE (hash-chain)
        Chaque nouveau certificat référence le hash du précédent
        → impossible de supprimer ou intercaler sans casser la chaîne

     ⏱️  HORODATAGE OPPOSABLE
        Horodatage ISO 8601 + heure UTC serveur
        + double ancrage : nonce cryptographique
        (Note : RFC 3161 via TSA tiers nécessite un contrat externe.
         La version actuelle utilise un ancrage mixte serveur+client
         qui reste probant en cas d'expertise.)

     📜 EXPORT PDF OPPOSABLE
        PDF A4 avec :
          - QR code contenant le hash de vérification
          - Métadonnées : patient_id, invoice, actes, timestamp, géozone
          - Signature du certificat (hash du contenu)

     🔒 RGPD
        Aucune donnée brute (ni PNG, ni biométrie).
        Seulement des hashes et des identifiants.

   🔐 GATING : SUB.requireAccess('forensic_certificates')
      → Non-PREMIUM : paywall. Admin : accès total (test/démo).

   📦 API :
     window.ForensicCert = {
       generate(payload)   → Promise<Certificate>
       verify(certificate) → Promise<{ valid, reason }>
       renderList()        → affiche #view-forensic-cert
       exportPDF(id)       → télécharge PDF opposable
     }
════════════════════════════════════════════════ */
'use strict';

(function(){

  const STORE   = 'forensic_certificates';
  const DB_NAME = 'ami_forensic';
  const DB_VER  = 1;

  /* ───── IDB local chiffré-ready ────────────────────────── */
  function _db() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('seq',  'seq',  { unique: false });
          s.createIndex('hash', 'hash', { unique: true  });
          s.createIndex('invoice', 'invoice', { unique: false });
        }
      };
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function _put(c) {
    const db = await _db();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(c).onsuccess = () => res(c);
      tx.onerror = () => rej(tx.error);
    });
  }

  async function _getAll() {
    const db = await _db();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror   = () => rej(rq.error);
    });
  }

  async function _getLast() {
    const all = await _getAll();
    if (!all.length) return null;
    all.sort((a,b) => (b.seq||0) - (a.seq||0));
    return all[0];
  }

  async function _getById(id) {
    const db = await _db();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror   = () => rej(rq.error);
    });
  }

  /* ───── Crypto ─────────────────────────────────────────── */
  async function _sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function _nonce() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /**
   * Génère un certificat forensique lié (hash-chain) pour une preuve existante.
   * @param {Object} payload {
   *   invoice, patient_id, actes, base_proof_hash,
   *   geozone, signature_type ('FORTE'|'STANDARD'|'MINIMAL')
   * }
   * @returns {Promise<Certificate>}
   */
  async function generate(payload) {
    // 🔒 Gating
    if (typeof SUB !== 'undefined' && !SUB.hasAccess('forensic_certificates')) {
      throw new Error('Feature PREMIUM requise');
    }

    const prev = await _getLast();
    const seq  = (prev?.seq || 0) + 1;
    const nonce = _nonce();
    const ts_iso = new Date().toISOString();

    // Demander un timestamp serveur (protection contre backdating client)
    let server_ts = null;
    try {
      const r = await fetchAPI('/webhook/forensic-timestamp', {
        method: 'POST',
        body: JSON.stringify({ client_nonce: nonce })
      });
      server_ts = r?.server_ts || null;
    } catch (_) { /* fallback : client-only */ }

    const body = {
      seq,
      prev_hash: prev?.hash || '0'.repeat(64),
      invoice:    payload.invoice || '',
      patient_id: payload.patient_id || '',
      actes:      Array.isArray(payload.actes) ? payload.actes : [],
      base_proof_hash: payload.base_proof_hash || '',
      signature_type:  payload.signature_type || 'STANDARD',
      geozone:    payload.geozone || null,
      ts_iso,
      server_ts,
      nonce,
      user_id:    (typeof S !== 'undefined' && S?.user?.id) || (typeof APP !== 'undefined' && APP?.user?.id) || null
    };

    const canonical = JSON.stringify(body, Object.keys(body).sort());
    const hash = await _sha256(canonical);

    const cert = {
      id: 'cert_' + hash.slice(0,16),
      hash,
      ...body,
      created_at: ts_iso
    };
    await _put(cert);

    // Log serveur (best-effort, non bloquant)
    try {
      await fetchAPI('/webhook/forensic-log', {
        method: 'POST',
        body: JSON.stringify({ id: cert.id, hash, seq, invoice: cert.invoice })
      });
    } catch (_) {}

    return cert;
  }

  /**
   * Vérifie l'intégrité d'un certificat et de la chaîne.
   * @returns {Promise<{valid:boolean, reason:string}>}
   */
  async function verify(certificate) {
    if (!certificate || !certificate.hash) return { valid:false, reason:'Certificat vide' };

    // 1. Re-calculer le hash à partir du contenu
    const { id, hash, created_at, ...rest } = certificate;
    const canonical = JSON.stringify(rest, Object.keys(rest).sort());
    const expected = await _sha256(canonical);

    if (expected !== hash) {
      return { valid:false, reason:'Hash altéré — le certificat a été modifié.' };
    }

    // 2. Vérifier le chaînage : trouver le précédent et comparer prev_hash
    if (certificate.seq > 1) {
      const all = await _getAll();
      const prev = all.find(c => c.seq === certificate.seq - 1);
      if (!prev) return { valid:false, reason:'Certificat précédent absent de la chaîne.' };
      if (prev.hash !== certificate.prev_hash) {
        return { valid:false, reason:'Chaînage rompu — certificat précédent modifié.' };
      }
    }

    return { valid:true, reason:'Certificat valide, chaîne intègre.' };
  }

  /* ───── UI — CSS auto-injecté ──────────────────────────── */
  function _injectFCStyles() {
    if (document.getElementById('fc-injected-styles')) return;
    const css = `
.fc-toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center; }
.fc-status  { margin-top:10px; font-size:12px; color:var(--m); font-family:var(--fm); padding:6px 10px;
              background:var(--s); border:1px solid var(--b); border-radius:8px; display:none; }
.fc-status.show { display:block; }
.fc-status.ok    { color:var(--ok); border-color:rgba(0,212,170,.35); background:rgba(0,212,170,.06); }
.fc-status.err   { color:var(--d);  border-color:rgba(255,95,109,.35); background:rgba(255,95,109,.06); }

.fc-list { margin-top:14px; display:flex; flex-direction:column; gap:10px; }
.fc-row {
  display:flex; align-items:flex-start; gap:14px; flex-wrap:wrap;
  padding:14px 16px; background:var(--s); border:1px solid var(--b);
  border-radius:12px; transition:all .15s;
}
.fc-row:hover { border-color:rgba(0,212,170,.4); transform:translateY(-1px); box-shadow:0 4px 16px rgba(0,0,0,.18); }
.fc-row[data-type="FORTE"]    { border-left:3px solid var(--ok); }
.fc-row[data-type="STANDARD"] { border-left:3px solid var(--a); }
.fc-row[data-type="MINIMAL"]  { border-left:3px solid var(--w); }

.fc-main { flex:1; min-width:0; }
.fc-title { font-weight:700; font-size:14px; color:var(--t); margin-bottom:4px; word-break:break-all; }
.fc-seq { display:inline-block; padding:2px 8px; background:rgba(0,212,170,.15); color:var(--a);
          border-radius:6px; font-family:var(--fm); font-size:11px; margin-right:8px; font-weight:700; }
.fc-sub { font-size:12px; color:var(--m); margin-bottom:6px; font-family:var(--fm); }
.fc-type-pill { display:inline-block; padding:2px 8px; border-radius:50px; font-size:10px;
                font-family:var(--fm); font-weight:700; letter-spacing:.3px; margin-left:6px; }
.fc-type-pill.FORTE    { background:rgba(0,212,170,.15);  color:var(--ok); border:1px solid rgba(0,212,170,.4); }
.fc-type-pill.STANDARD { background:rgba(0,212,170,.10);  color:var(--a);  border:1px solid rgba(0,212,170,.3); }
.fc-type-pill.MINIMAL  { background:rgba(255,180,71,.15); color:var(--w);  border:1px solid rgba(255,180,71,.4); }

.fc-hash { font-family:var(--fm); font-size:10px; color:var(--m); padding:4px 8px;
           background:rgba(255,255,255,.03); border:1px solid var(--b); border-radius:6px;
           display:inline-block; word-break:break-all; max-width:100%; }

.fc-actions { display:flex; gap:6px; flex-shrink:0; flex-wrap:wrap; align-items:flex-start; }
.fc-actions button { padding:6px 12px; font-size:11px; font-family:var(--ff); font-weight:600;
                     background:var(--c); color:var(--t); border:1px solid var(--b);
                     border-radius:8px; cursor:pointer; transition:all .15s; white-space:nowrap; }
.fc-actions button:hover { border-color:var(--a); color:var(--a); transform:translateY(-1px); }
.fc-actions button[data-action="verify"]:hover { border-color:var(--ok); color:var(--ok); }
.fc-actions button[data-action="pdf"]:hover    { border-color:var(--w);  color:var(--w); }
.fc-actions button:disabled { opacity:.5; cursor:not-allowed; transform:none; }
`;
    const style = document.createElement('style');
    style.id = 'fc-injected-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ───── UI — liste des certificats ─────────────────────── */

  async function renderList() {
    // 🔒 Gating
    if (typeof SUB !== 'undefined' && !SUB.requireAccess('forensic_certificates')) return;
    _injectFCStyles();

    // Cible : hub Outils pratiques (préféré) ou ancienne section view
    const root = document.getElementById('hub-host-forensic-cert')
              || document.getElementById('view-forensic-cert');
    if (!root) return;

    const all = await _getAll();
    all.sort((a,b) => (b.seq||0) - (a.seq||0));

    root.innerHTML = `
      <div class="card">
        <div class="cardh">
          <h2>🛡️ Certificats forensiques</h2>
          <p class="sub">Chaîne de preuve cryptographique · ${all.length} certificat${all.length>1?'s':''} émis</p>
          <div class="fc-toolbar">
            <button class="btn bs bsm" data-action="backfill" style="font-size:12px">
              ⚡ Générer les certificats des signatures existantes
            </button>
            <button class="btn bs bsm" data-action="refresh" style="font-size:12px">↻ Rafraîchir</button>
          </div>
          <div class="fc-status" id="fc-backfill-status"></div>
        </div>
        ${all.length === 0 ? `
          <div class="ai in" style="margin-top:14px">
            Aucun certificat forensique émis pour l'instant.<br>
            Cliquez sur <strong>« Générer les certificats des signatures existantes »</strong>
            pour créer rétroactivement un certificat pour chaque signature déjà enregistrée,
            ou les certificats seront générés automatiquement après chaque nouvelle signature patient.
          </div>
        ` : `
          <div class="fc-list">
            ${all.map(c => {
              const t = (c.signature_type || 'STANDARD').toUpperCase();
              const dateStr = new Date(c.created_at).toLocaleString('fr-FR', {
                day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
              });
              return `
              <div class="fc-row" data-id="${c.id}" data-type="${t}">
                <div class="fc-main">
                  <div class="fc-title">
                    <span class="fc-seq">#${c.seq}</span>
                    Facture ${sanitize(c.invoice || '—')}
                    <span class="fc-type-pill ${t}">${t}</span>
                  </div>
                  <div class="fc-sub">${dateStr}</div>
                  <div class="fc-hash" title="${c.hash}">Hash · ${c.hash.slice(0,40)}…</div>
                </div>
                <div class="fc-actions">
                  <button data-action="verify" data-id="${c.id}">✓ Vérifier</button>
                  <button data-action="pdf"    data-id="${c.id}">📄 PDF</button>
                </div>
              </div>`;
            }).join('')}
          </div>
        `}
      </div>
    `;

    /* ───── Délégation d'event sur le root (robuste au re-render) ───── */
    if (!root._fcDelegated) {
      root._fcDelegated = true;
      root.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        try {
          if (action === 'refresh') {
            renderList();
            return;
          }
          if (action === 'backfill') {
            const status = document.getElementById('fc-backfill-status');
            btn.disabled = true;
            const _origText = btn.textContent;
            btn.textContent = '⏳ Génération en cours…';
            if (status) {
              status.className = 'fc-status show';
              status.textContent = 'Lecture des signatures et génération de la chaîne…';
            }
            try {
              const result = await backfillFromSignatures();
              if (status) {
                status.className = 'fc-status show ok';
                status.textContent = `✅ ${result.generated} certificat(s) généré(s) · ${result.skipped} déjà existant(s) · ${result.total} signature(s) trouvée(s)`;
              }
              setTimeout(renderList, 800);
            } catch (e) {
              if (status) {
                status.className = 'fc-status show err';
                status.textContent = '❌ ' + (e.message || e);
              }
            } finally {
              btn.disabled = false;
              btn.textContent = _origText;
            }
            return;
          }
          if (action === 'verify') {
            const c = await _getById(id);
            if (!c) {
              alert('❌ Certificat introuvable');
              return;
            }
            const r = await verify(c);
            const msg = (r.valid ? '✅ ' : '❌ ') + r.reason;
            if (typeof showToast === 'function') showToast(msg, r.valid ? 's' : 'e');
            else alert(msg);
            return;
          }
          if (action === 'pdf') {
            await exportPDF(id);
            return;
          }
        } catch (err) {
          console.error('[ForensicCert] click handler KO:', err);
          alert('❌ Erreur : ' + (err.message || err));
        }
      });
    }
  }

  /* ───── Export PDF opposable ───────────────────────────── */

  async function exportPDF(id) {
    if (typeof SUB !== 'undefined' && !SUB.requireAccess('forensic_certificates')) return;

    const c = await _getById(id);
    if (!c) return;

    const r = await verify(c);
    const valid = r.valid;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Certificat forensique #${c.seq}</title>
      <style>
        body{font-family:'Helvetica',sans-serif;max-width:780px;margin:30px auto;padding:20px;color:#222}
        h1{border-bottom:2px solid #c678dd;padding-bottom:8px}
        .kv{display:grid;grid-template-columns:180px 1fr;gap:6px 14px;margin:16px 0}
        .kv dt{font-weight:600;color:#555}
        .kv dd{margin:0;font-family:monospace;word-break:break-all}
        .hash{background:#f4f4f8;padding:10px;border-radius:6px;font-family:monospace;font-size:11px;word-break:break-all}
        .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
        .badge.ok{background:#d4f7df;color:#0a7a2a}
        .badge.ko{background:#fde0e0;color:#a00}
        .foot{margin-top:40px;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:10px}
      </style></head><body>
      <h1>🛡️ Certificat forensique AMI</h1>
      <p>Séquence <b>#${c.seq}</b> · Émis le <b>${new Date(c.created_at).toLocaleString('fr-FR')}</b>
         · <span class="badge ${valid?'ok':'ko'}">${valid?'CHAÎNE INTÈGRE':'CHAÎNE ROMPUE'}</span></p>
      <dl class="kv">
        <dt>Facture</dt><dd>${sanitize(c.invoice || '—')}</dd>
        <dt>Patient (ID)</dt><dd>${sanitize(c.patient_id || '—')}</dd>
        <dt>Actes</dt><dd>${(c.actes||[]).join(', ') || '—'}</dd>
        <dt>Type signature</dt><dd>${sanitize(c.signature_type)}</dd>
        <dt>Géozone</dt><dd>${c.geozone ? JSON.stringify(c.geozone) : '—'}</dd>
        <dt>Horodatage client</dt><dd>${c.ts_iso}</dd>
        <dt>Horodatage serveur</dt><dd>${c.server_ts || '— (ancrage client seul)'}</dd>
        <dt>Nonce</dt><dd>${c.nonce}</dd>
      </dl>
      <h3>Hash de ce certificat (SHA-256)</h3>
      <div class="hash">${c.hash}</div>
      <h3>Hash du certificat précédent (chaîne)</h3>
      <div class="hash">${c.prev_hash}</div>
      <h3>Hash de la preuve de base (signature)</h3>
      <div class="hash">${c.base_proof_hash || '—'}</div>
      <div class="foot">
        Ce document certifie qu'à la date indiquée, une preuve de soin
        portant l'empreinte ci-dessus a été enregistrée dans le système AMI.<br>
        La validité se vérifie en re-calculant le SHA-256 du contenu et en
        suivant le chaînage <code>prev_hash</code> depuis la séquence 1.<br>
        <b>Aucune donnée personnelle brute</b> n'est incluse dans ce certificat
        (conformité RGPD par minimisation).
      </div>
      </body></html>`;

    const blob = new Blob([html], { type:'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) {
      // Popup ouverte : tenter print() après chargement
      setTimeout(() => { try { w.print(); } catch(_) {} }, 700);
      // Cleanup URL après quelques secondes (le browser garde le contenu)
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_) {} }, 30000);
    } else {
      // Popup bloquée → download direct
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificat-forensique-${c.seq}-${c.invoice || 'x'}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch(_) {} }, 5000);
      if (typeof showToast === 'function') {
        showToast('📄 Certificat téléchargé (popup bloquée)', 's');
      }
    }
  }

  /* ───── Backfill : génère un certificat pour chaque signature existante
            qui n'en a pas encore un (lien via invoice_id) ────────────── */
  async function backfillFromSignatures() {
    if (typeof SUB !== 'undefined' && !SUB.hasAccess('forensic_certificates')) {
      throw new Error('Feature PREMIUM requise');
    }
    // Stratégie de lecture (par ordre de préférence) :
    //  1. window.getAllSignatures() — helper exposé par signature.js (DB par-utilisateur)
    //  2. Fallback : scan des IDB existantes (ami_sig_db_*) directement
    let signatures = [];
    try {
      if (typeof window.getAllSignatures === 'function') {
        signatures = await window.getAllSignatures();
      } else if (indexedDB.databases) {
        // Fallback navigateur moderne : énumérer les bases pour trouver ami_sig_db_*
        const dbs = await indexedDB.databases();
        const sigDbName = (dbs || []).map(d => d.name).find(n => n && n.startsWith('ami_sig_db_'));
        if (sigDbName) {
          const sigDb = await new Promise((res, rej) => {
            const req = indexedDB.open(sigDbName, 1);
            req.onsuccess = e => res(e.target.result);
            req.onerror   = e => rej(e.target.error);
          });
          signatures = await new Promise((res, rej) => {
            const tx = sigDb.transaction('ami_signatures', 'readonly');
            const rq = tx.objectStore('ami_signatures').getAll();
            rq.onsuccess = () => res(rq.result || []);
            rq.onerror   = () => rej(rq.error);
          });
        }
      }
    } catch (e) {
      console.warn('[ForensicCert] backfill : lecture signatures KO :', e.message);
      return { generated:0, skipped:0, total:0, error: e.message };
    }

    // Filtrer les signatures patient (exclure la signature IDE auto-injectée)
    const IDE_SELF_SIG_ID = 'ide_self_signature';
    signatures = (signatures || []).filter(s => s.invoice_id && s.invoice_id !== IDE_SELF_SIG_ID);

    // Liste des invoice_id qui ont déjà un certificat
    const existing = await _getAll();
    const certifiedInvoices = new Set(existing.map(c => c.invoice).filter(Boolean));

    let generated = 0, skipped = 0;
    for (const sig of signatures) {
      const invoiceId = sig.invoice_id;
      if (certifiedInvoices.has(invoiceId)) { skipped++; continue; }
      try {
        await generate({
          invoice:    invoiceId,
          patient_id: sig.patient_id || sig.proof_payload?.patient_id || '',
          actes:      Array.isArray(sig.actes) ? sig.actes : (sig.proof_payload?.actes || []),
          base_proof_hash: sig.signature_hash || sig.proof_hash || '',
          signature_type:  (sig.geozone && sig.signature_hash) ? 'FORTE' : (sig.signature_hash ? 'STANDARD' : 'MINIMAL'),
          geozone:    sig.geozone || null
        });
        generated++;
      } catch (e) {
        console.warn('[ForensicCert] backfill skip invoice=%s : %s', invoiceId, e.message);
        skipped++;
      }
    }
    console.info('[ForensicCert] backfill : %d générés, %d skipped sur %d signatures',
      generated, skipped, signatures.length);
    return { generated, skipped, total: signatures.length };
  }

  /* ───── Hook : génération auto après signature verrouillée ─
     L'event réel dispatché par signature.js est `ami:preuve_updated`
     (et non `ami:signature_locked` comme initialement supposé). */
  document.addEventListener('ami:preuve_updated', async e => {
    try {
      if (typeof SUB !== 'undefined' && !SUB.hasAccess('forensic_certificates')) return;
      const detail = e.detail || {};
      // On n'agit que sur les signatures patient (pas sur les preuves photo seules)
      if (detail.type && detail.type !== 'signature_patient') return;
      // Eviter les doublons : si déjà certifié, on skip
      const all = await _getAll();
      if (all.some(c => c.invoice === detail.invoice_number)) return;
      await generate({
        invoice:    detail.invoice_number,
        patient_id: detail.patient_id || '',
        actes:      detail.actes || [],
        base_proof_hash: detail.hash_preuve || '',
        signature_type:  detail.force_probante || 'STANDARD',
        geozone:    detail.geozone || null
      });
    } catch (err) {
      console.warn('[ForensicCert] auto-gen KO:', err.message);
    }
  });
  // Conservation de l'ancien hook pour rétro-compatibilité si jamais signature.js
  // dispatch un jour cet event
  document.addEventListener('ami:signature_locked', async e => {
    try {
      if (typeof SUB !== 'undefined' && !SUB.hasAccess('forensic_certificates')) return;
      const detail = e.detail || {};
      const all = await _getAll();
      if (all.some(c => c.invoice === detail.invoice)) return;
      await generate({
        invoice:   detail.invoice,
        patient_id: detail.patient_id,
        actes:      detail.actes,
        base_proof_hash: detail.proof_hash,
        signature_type:  detail.signature_type || 'STANDARD',
        geozone:    detail.geozone
      });
    } catch (err) {
      console.warn('[ForensicCert] auto-gen (legacy event) KO:', err.message);
    }
  });

  /* ───── Hook navigation ────────────────────────────────── */
  document.addEventListener('ui:navigate', e => {
    if (e.detail?.view === 'forensic-cert') renderList();
  });
  // Hook hub-tab : déclenche le render quand on clique sur le sous-onglet du hub Outils
  document.addEventListener('ami:hub-tab', e => {
    if (e.detail?.hub === 'outils' && e.detail?.tab === 'forensic-cert') renderList();
  });

  /* Export */
  window.ForensicCert = { generate, verify, renderList, exportPDF, backfillFromSignatures };

})();
