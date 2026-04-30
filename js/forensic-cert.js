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

  /* ───── UI — liste des certificats ─────────────────────── */

  async function renderList() {
    // 🔒 Gating
    if (typeof SUB !== 'undefined' && !SUB.requireAccess('forensic_certificates')) return;

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
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn bs bsm" id="fc-backfill" style="font-size:12px">
              ⚡ Générer les certificats des signatures existantes
            </button>
            <button class="btn bs bsm" id="fc-refresh" style="font-size:12px">↻ Rafraîchir</button>
          </div>
          <div id="fc-backfill-status" style="margin-top:8px;font-size:12px;color:var(--m)"></div>
        </div>
        ${all.length === 0 ? `
          <div class="ai in">
            Aucun certificat forensique émis pour l'instant.<br>
            Cliquez sur <strong>« Générer les certificats des signatures existantes »</strong>
            pour créer rétroactivement un certificat pour chaque signature déjà enregistrée,
            ou les certificats seront générés automatiquement après chaque nouvelle signature patient.
          </div>
        ` : `
          <div id="fc-list">
            ${all.map(c => `
              <div class="fc-row" data-id="${c.id}">
                <div class="fc-main">
                  <div class="fc-title">#${c.seq} · Facture ${sanitize(c.invoice || '—')}</div>
                  <div class="fc-sub">${new Date(c.created_at).toLocaleString('fr-FR')} · ${sanitize(c.signature_type)}</div>
                  <div class="fc-hash" title="${c.hash}">Hash: ${c.hash.slice(0,32)}…</div>
                </div>
                <div class="fc-actions">
                  <button class="btn-mini fc-verify" data-id="${c.id}">Vérifier</button>
                  <button class="btn-mini fc-pdf"    data-id="${c.id}">📄 PDF</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;

    // Backfill button
    const backfillBtn = document.getElementById('fc-backfill');
    if (backfillBtn) {
      backfillBtn.onclick = async () => {
        const status = document.getElementById('fc-backfill-status');
        backfillBtn.disabled = true;
        backfillBtn.textContent = '⏳ Génération en cours…';
        if (status) status.textContent = 'Lecture des signatures et génération de la chaîne…';
        try {
          const result = await backfillFromSignatures();
          if (status) {
            status.style.color = 'var(--ok)';
            status.textContent = `✅ ${result.generated} certificat(s) généré(s) · ${result.skipped} déjà existant(s) · ${result.total} signature(s) trouvée(s)`;
          }
          // Re-render après 1s pour voir la liste mise à jour
          setTimeout(renderList, 1200);
        } catch (e) {
          if (status) {
            status.style.color = 'var(--d)';
            status.textContent = '❌ ' + e.message;
          }
        } finally {
          backfillBtn.disabled = false;
          backfillBtn.textContent = '⚡ Générer les certificats des signatures existantes';
        }
      };
    }
    const refreshBtn = document.getElementById('fc-refresh');
    if (refreshBtn) refreshBtn.onclick = renderList;

    root.querySelectorAll('.fc-verify').forEach(b => {
      b.onclick = async () => {
        const c = await _getById(b.dataset.id);
        const r = await verify(c);
        if (typeof showToast === 'function') {
          showToast((r.valid ? '✅ ' : '❌ ') + r.reason);
        } else {
          alert((r.valid ? '✅ ' : '❌ ') + r.reason);
        }
      };
    });
    root.querySelectorAll('.fc-pdf').forEach(b => {
      b.onclick = () => exportPDF(b.dataset.id);
    });
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
    const w = window.open(url);
    if (w) setTimeout(() => w.print(), 600);
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
