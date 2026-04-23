/* ════════════════════════════════════════════════════════════════════════
   historique.js — AMI NGAP — Historique des soins
   ────────────────────────────────────────────────────────────────────────
   Extrait de index.html le 2026-04-23 — module dédié à l'onglet Historique.
   ─ hist()         : rendu du tableau des cotations (période, recherche)
   ─ delHist()      : suppression d'une cotation (Supabase + IDB)
   ─ resetAllHist() : reset en masse pour la période sélectionnée
   ─ editFromHist() : ouvrir une cotation dans l'écran cotation pour modif

   ⚠️ Mode Uber Médical : la génération des entrées dans l'Historique des
   soins se fait via les webhooks `/ami-calcul` (création) puis
   `/ami-save-cotation` (push) appelés depuis tournee.js — _validateCotationLive,
   autoFacturation, _syncCotationsToSupabase, openCotationPatient. Les champs
   transmis et lus ici sont :
      patient_nom, patient_id, invoice_number, date_soin, heure_soin,
      actes, total, source, dre_requise, ides
   Tout changement de noms de champs ici DOIT être répercuté côté tournee.js.

   Dépendances (résolues globalement à l'exécution) :
      S, APP, SUB, fetchAPI, wpost, showToast, navTo, renderLiveReco,
      _idbGetAll, _idbPut, _dec, _enc, _syncPatientNow, PATIENTS_STORE,
      _dashCacheKey, DASH_CACHE_KEY, loadDash

   ⚠️ Charger ce fichier APRÈS tournee.js et planning.js dans index.html.
════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   hist() — Historique des cotations
   Accessible infirmière ET admin (chacun voit ses propres données)
   ═══════════════════════════════════════════════════════════ */
async function hist() {
  const tbody = document.getElementById('htb');
  const stats = document.getElementById('hstats');
  if (!tbody) return;

  // 🏥 Colonne IDE(s) : visible uniquement si membre d'un cabinet multi-IDE.
  //   L'admin en bypass réel la voit aussi (pour debug/test).
  //   L'admin en simulation suit la logique "IDEL simulée" : si pas cabinet member, masqué.
  (function _toggleIdeCol() {
    const st = (typeof SUB !== 'undefined' && SUB.getState) ? SUB.getState() : null;
    const showIdeCol = st
      ? (st.cabinetMember || (st.isAdmin && !st.isAdminSim))
      : true;  // fallback si SUB pas chargé : on affiche (non-régression)
    const histTable = document.querySelector('#view-his .ht table');
    if (histTable) histTable.classList.toggle('hist-hide-ide', !showIdeCol);
  })();

  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px"><div class="spin spinw" style="width:24px;height:24px;margin:0 auto"></div></td></tr>';

  const q       = (document.getElementById('hq')?.value || '').toLowerCase().trim();
  const period  = document.getElementById('hp')?.value || '';
  const isAdmin = (typeof S !== 'undefined') && S?.role === 'admin';

  /* Afficher/masquer notices selon le rôle */
  const adminNotice = document.getElementById('his-admin-notice');
  const nurseNotice = document.getElementById('his-nurse-notice');
  if (adminNotice) adminNotice.style.display = isAdmin ? 'flex' : 'none';
  if (nurseNotice) nurseNotice.style.display = isAdmin ? 'none' : 'flex';

  try {
    const url = period
      ? `/webhook/ami-historique?period=${period}`
      : '/webhook/ami-historique?period=month';
    const d   = typeof fetchAPI === 'function' ? await fetchAPI(url) : await (typeof wpost === 'function' ? wpost('/webhook/ami-historique', { period: period || 'month' }) : null);
    let rows  = Array.isArray(d?.data) ? d.data : (Array.isArray(d) ? d : []);

    /* Filtre recherche locale */
    if (q) {
      rows = rows.filter(r => {
        const date = (r.date_soin || '').toLowerCase();
        const nom  = (r.patient_nom || r.nom || '').toLowerCase();
        const inv  = String(r.invoice_number || '').toLowerCase();
        const actes = (() => { try { return JSON.parse(r.actes||'[]').map(a=>a.code||'').join(' ').toLowerCase(); } catch { return ''; } })();
        return date.includes(q) || actes.includes(q) || String(r.id).includes(q) || nom.includes(q) || inv.includes(q);
      });
    }

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--m)">Aucune cotation sur cette période.</td></tr>';
      if (stats) stats.innerHTML = '';
      return;
    }

    /* Stats rapides */
    const totalCA  = rows.reduce((s, r) => s + parseFloat(r.total||0), 0);
    const totalAMO = rows.reduce((s, r) => s + parseFloat(r.part_amo||0), 0);
    if (stats) stats.innerHTML = `
      <div class="sc g"><div class="si">💶</div><div class="sv">${totalCA.toFixed(0)}€</div><div class="sn">Total</div></div>
      <div class="sc b"><div class="si">🏥</div><div class="sv">${totalAMO.toFixed(0)}€</div><div class="sn">AMO</div></div>
      <div class="sc o"><div class="si">📋</div><div class="sv">${rows.length}</div><div class="sn">Actes</div></div>`;

    /* Palette couleurs avatars en rotation */
    const _avatarCols = ['col-a','col-b','col-c','col-d','col-e'];
    const _avatarMap = {};
    let _avatarIdx = 0;

    /* Tableau premium */
    tbody.innerHTML = rows.map(r => {
      // ── Date + heure ─────────────────────────────────────────────────────
      // Champs alimentés par Mode Uber Médical via /ami-save-cotation :
      //   date_soin  ← _validateCotationLive / _syncCotationsToSupabase / autoFacturation
      //   heure_soin ← idem (heure RÉELLE du clic "Terminer", pas la contrainte planifiée)
      const dateObj  = r.date_soin ? new Date(r.date_soin) : null;
      const dateStr  = dateObj ? dateObj.toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}) : '—';
      const heureRaw = (r.heure_soin || '').trim().slice(0,5);
      const heureStr = heureRaw && /^\d{1,2}:\d{2}/.test(heureRaw) ? heureRaw : null;
      const dateHtml = `<div style="font-size:12px;font-weight:500;color:var(--t)">${dateStr}</div>
        ${heureStr
          ? `<div style="display:inline-flex;align-items:center;gap:4px;margin-top:3px;background:rgba(79,168,255,.1);border:1px solid rgba(79,168,255,.18);border-radius:6px;padding:1px 7px">
               <span style="font-size:10px;color:var(--a2)">🕐</span>
               <span style="font-family:var(--fm);font-size:11px;color:var(--a2);font-weight:600">${heureStr}</span>
             </div>`
          : `<div style="font-size:10px;color:var(--m);margin-top:2px;font-family:var(--fm)">— heure non renseignée</div>`}`;

      // ── N° Facture ────────────────────────────────────────────────────────
      // invoice_number : généré côté worker au PUSH /ami-save-cotation, retourné
      //                  et propagé en mémoire + IDB par _syncCotationsToSupabase.
      const invNum  = (r.invoice_number || '').toString().trim();
      const invHtml = invNum
        ? `<div style="display:inline-flex;align-items:center;gap:5px">
             <span style="font-family:var(--fm);font-size:10px;letter-spacing:.5px;color:var(--m)">N°</span>
             <span style="font-family:var(--fm);font-size:12px;font-weight:600;color:var(--a);background:rgba(0,212,170,.08);border:1px solid rgba(0,212,170,.18);border-radius:6px;padding:2px 8px">${invNum}</span>
           </div>`
        : `<span style="font-size:11px;color:var(--m);font-family:var(--fm)">—</span>`;

      // ── Actes ─────────────────────────────────────────────────────────────
      let actesTxt = '—';
      let actesArr = [];
      try {
        actesArr = Array.isArray(r.actes) ? r.actes : JSON.parse(r.actes || '[]');
        actesTxt = actesArr.map(a => a.code || '').filter(Boolean).join(', ') || '—';
      } catch {}
      const actesHtml = actesArr.length
        ? actesArr.map(a => a.code ? `<span style="display:inline-block;background:rgba(79,168,255,.08);border:1px solid rgba(79,168,255,.15);border-radius:5px;padding:1px 6px;font-family:var(--fm);font-size:10px;color:var(--a2);margin:1px 2px 1px 0">${a.code}</span>` : '').filter(Boolean).join('')
        : '<span style="color:var(--m);font-size:11px">—</span>';

      // ── Alertes ───────────────────────────────────────────────────────────
      const alertCount = (() => { try { return JSON.parse(r.alerts||'[]').length; } catch { return 0; } })();
      const alertsHtml = alertCount ? `<span style="background:rgba(255,95,109,.12);color:var(--d);font-family:var(--fm);font-size:10px;padding:2px 7px;border-radius:10px;border:1px solid rgba(255,95,109,.2)">⚠ ${alertCount}</span>` : `<span style="color:var(--ok);font-size:11px">✓</span>`;

      // ── Avatar patient ────────────────────────────────────────────────────
      // patient_nom : transmis par tournee.js / cotation.js, INDISPENSABLE pour
      // éviter un avatar "?" sur la ligne. r.nom = fallback legacy.
      const patNom = (r.patient_nom || r.nom || '').trim();
      const initials = patNom ? patNom.split(/\s+/).map(w=>w.charAt(0)).slice(0,2).join('').toUpperCase() : '?';
      if (patNom && !_avatarMap[patNom]) { _avatarMap[patNom] = _avatarCols[_avatarIdx++ % 5]; }
      const avatarCol = _avatarMap[patNom] || 'col-a';

      // ── Statut DRE ────────────────────────────────────────────────────────
      const statutHtml = r.dre_requise
        ? `<span class="pt-status pause"><span class="pt-status-dot pause"></span><span style="font-size:11px">DRE req.</span></span>`
        : `<span class="pt-status active"><span class="pt-status-dot active"></span><span style="font-size:11px">Conforme</span></span>`;

      const _rowId = `hist-row-${r.id}`;

      // ── Colonne IDE(s) — multi-source : _assignedIdes[] > performed_by_list[] > infirmiere_nom/prenom > APP.user ──
      let _ideLabels = [];
      if (Array.isArray(r._assignedIdes) && r._assignedIdes.length) {
        // Futur : tableau d'IDs → résoudre via cabinet.members
        const cab = (typeof APP !== 'undefined' && APP.get) ? APP.get('cabinet') : null;
        const memberMap = {};
        (cab?.members || []).forEach(m => {
          const id = m.id || m.infirmiere_id;
          if (id) memberMap[id] = `${m.prenom||''} ${m.nom||''}`.trim() || id;
        });
        _ideLabels = r._assignedIdes.map(id => memberMap[id] || id);
      } else if (Array.isArray(r.performed_by_list) && r.performed_by_list.length) {
        _ideLabels = r.performed_by_list.map(x => String(x));
      } else if (r.infirmiere_prenom || r.infirmiere_nom) {
        _ideLabels = [`${r.infirmiere_prenom||''} ${r.infirmiere_nom||''}`.trim()];
      } else if (typeof APP !== 'undefined' && APP.user) {
        // Fallback : l'utilisateur connecté (cotation créée par lui-même)
        _ideLabels = [`${APP.user.prenom||''} ${APP.user.nom||''}`.trim() || 'Moi'];
      }

      const _ideColors = ['var(--a)', '#4fa8ff', '#ff9f43', '#ff6b6b', '#a29bfe'];
      const idesHtml = _ideLabels.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:3px;max-width:140px">${_ideLabels.map((lbl, i) => {
            const c = _ideColors[i % _ideColors.length];
            const initials = lbl.split(/\s+/).map(w => w[0]||'').join('').slice(0,2).toUpperCase();
            return `<span title="${lbl.replace(/"/g,'&quot;')}" style="display:inline-flex;align-items:center;gap:3px;background:rgba(0,212,170,.08);border:1px solid ${c};border-radius:10px;padding:1px 6px;font-size:10px;font-family:var(--fm);color:${c};white-space:nowrap">
              <span style="width:5px;height:5px;border-radius:50%;background:${c};flex-shrink:0"></span>
              ${initials}
            </span>`;
          }).join('')}</div>`
        : `<span style="font-size:10px;color:var(--m)">—</span>`;

      return `<tr id="${_rowId}">
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="pt-avatar ${avatarCol}" style="width:34px;height:34px;font-size:12px;flex-shrink:0">${initials}</div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--t)">${patNom || '—'}</div>
              <div style="font-size:10px;color:var(--m);font-family:var(--fm);margin-top:1px">ID&nbsp;#${r.id}</div>
            </div>
          </div>
        </td>
        <td>${dateHtml}</td>
        <td>${invHtml}</td>
        <td style="max-width:160px">${actesHtml}</td>
        <td class="pt-ca" style="white-space:nowrap">${parseFloat(r.total||0).toFixed(2)}&nbsp;€</td>
        <td>${statutHtml}</td>
        <td class="hist-col-ide">${idesHtml}</td>
        <td>${alertsHtml}</td>
        <td><button class="btn bs bsm hist-edit-btn" style="font-size:10px;padding:3px 8px"
          data-hist-id="${r.id}"
          data-hist-inv="${(r.invoice_number||'').replace(/"/g,'&quot;')}"
          data-hist-date="${(r.date_soin||'').replace(/"/g,'&quot;')}"
          data-hist-heure="${(r.heure_soin||'').replace(/"/g,'&quot;')}"
          data-hist-patid="${(r.patient_id||'').replace(/"/g,'&quot;')}"
          data-hist-patnom="${(r.patient_nom||r.nom||'').replace(/"/g,'&quot;')}"
          data-hist-actes="${encodeURIComponent(JSON.stringify(actesArr))}"
          title="Modifier cette cotation">✏️</button></td>
        <td><button class="btn bd bsm" style="font-size:10px;padding:3px 8px" onclick="delHist(${r.id}, this)" data-inv="${(r.invoice_number||'').replace(/"/g,'&quot;')}" title="Supprimer cette cotation">🗑️</button></td>
      </tr>`;
    }).join('');

  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px"><div class="ai er">⚠️ ${e.message}</div></td></tr>`;
  }
}

async function delHist(id, btnOrInvoice) {
  // Accepte soit un element bouton (data-inv) soit une string directe (retrocompat)
  const invoiceNumber = (btnOrInvoice instanceof Element)
    ? (btnOrInvoice.dataset.inv || '')
    : (btnOrInvoice || '');
  if (!confirm(`Supprimer la cotation #${id} ?`)) return;
  try {
    await (typeof wpost === 'function'
      ? wpost('/webhook/ami-supprimer', { id })
      : fetchAPI('/webhook/ami-supprimer', { method:'POST', body: JSON.stringify({ id }) }));

    // Synchroniser la suppression dans le carnet patient IDB
    // La cotation sera retirée de l'IDB via invoice_number (si disponible)
    if (invoiceNumber && typeof _idbGetAll === 'function' && typeof PATIENTS_STORE !== 'undefined') {
      try {
        const allRows = await _idbGetAll(PATIENTS_STORE);
        for (const row of allRows) {
          const p = { ...((typeof _dec === 'function' ? _dec(row._data) : null) || {}), id: row.id, nom: row.nom, prenom: row.prenom };
          if (!Array.isArray(p.cotations)) continue;
          const idx = p.cotations.findIndex(c => c.invoice_number === invoiceNumber);
          if (idx < 0) continue;
          p.cotations.splice(idx, 1);
          p.updated_at = new Date().toISOString();
          const toStore = { id: row.id, nom: row.nom, prenom: row.prenom, _data: (typeof _enc === 'function' ? _enc(p) : p), updated_at: p.updated_at };
          if (typeof _idbPut === 'function') await _idbPut(PATIENTS_STORE, toStore);
          // Push fiche mise à jour vers carnet_patients
          if (typeof _syncPatientNow === 'function') _syncPatientNow(toStore).catch(() => {});
          break; // une cotation ne peut appartenir qu'à un seul patient
        }
      } catch (e) { console.warn('[delHist] sync IDB KO:', e?.message); }
    }

    hist();
    if (typeof showToast === 'function') showToast('success', 'Cotation supprimée', `#${id} retirée de l'historique`);
  } catch(e) {
    if (typeof showToast === 'function') showToast('❌ ' + e.message);
  }
}

async function resetAllHist() {
  const period  = document.getElementById('hp')?.value || 'month';
  const periodLabel = { month:'ce mois', lastmonth:'le mois précédent', '3month':'les 3 derniers mois', year:'cette année' }[period] || period;
  if (!confirm(`⚠️ Supprimer TOUTES les cotations de ${periodLabel} ?\n\nCette action est irréversible.`)) return;
  if (!confirm(`Confirmer la suppression définitive de toutes les cotations de ${periodLabel} ?`)) return;

  const tbody = document.getElementById('htb');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px"><div class="spin spinw" style="width:24px;height:24px;margin:0 auto 8px"></div><div style="font-size:12px;color:var(--m);margin-top:8px">Suppression en cours...</div></td></tr>';

  try {
    // ── Suppression en masse — un seul appel Supabase, plus fiable que N appels séquentiels ──
    const res = await wpost('/webhook/ami-supprimer-tout', { period, force: true });
    if (!res?.ok) throw new Error(res?.message || res?.error || 'Erreur serveur');

    // Invalider le cache dashboard
    try {
      const cacheKey = (typeof _dashCacheKey === 'function') ? _dashCacheKey() : (typeof DASH_CACHE_KEY !== 'undefined' ? DASH_CACHE_KEY : null);
      if (cacheKey) localStorage.removeItem(cacheKey);
    } catch {}

    const msg = res.deleted > 0
      ? `✅ ${res.deleted} cotation(s) supprimée(s).`
      : 'ℹ️ Aucune cotation à supprimer pour cette période.';
    if (typeof showToast === 'function') showToast(msg, 'ok');

    hist();
    if (document.getElementById('view-dash')?.classList.contains('on') && typeof loadDash === 'function') loadDash();

  } catch(e) {
    console.error('[resetAllHist]', e);
    if (typeof showToast === 'function') showToast('❌ ' + e.message, 'err');
    hist();
  }
}

/* Charger l'historique automatiquement à la navigation — géré par ui.js */

/* ═══════════════════════════════════════════════════════════
   editFromHist(data) — Modifier une cotation depuis l'historique
   Pose _editingCotation (sans _autoDetected) avant navigation
   → bypass de la modale doublon, mode upsert garanti.
   ═══════════════════════════════════════════════════════════ */
async function editFromHist(data) {
  if (!data) return;

  const invNum   = data.invoice_number || null;
  const dateSoin = data.date_soin ? data.date_soin.slice(0, 10) : null;

  // ── Résoudre patientId + cotationIdx + données patient depuis l'IDB ────
  let patientId   = data.patient_id || null;
  let cotationIdx = -1;
  let patData     = {};

  try {
    if (typeof _idbGetAll === 'function' && typeof PATIENTS_STORE !== 'undefined') {
      const allRows = await _idbGetAll(PATIENTS_STORE);

      // Chercher d'abord par patient_id direct, sinon par invoice_number ou date
      let foundRow = null;
      if (patientId) {
        foundRow = allRows.find(r => r.id === patientId);
      }
      if (!foundRow) {
        for (const row of allRows) {
          if (typeof _dec !== 'function') continue;
          const p = { ...(_dec(row._data) || {}), id: row.id };
          if (!Array.isArray(p.cotations)) continue;
          let idx = -1;
          if (invNum)   idx = p.cotations.findIndex(c => c.invoice_number === invNum);
          if (idx < 0 && dateSoin) idx = p.cotations.findIndex(c => (c.date || '').slice(0, 10) === dateSoin);
          if (idx >= 0) { foundRow = row; cotationIdx = idx; break; }
        }
      }

      if (foundRow) {
        patientId = foundRow.id;
        const p   = typeof _dec === 'function' ? { ...(_dec(foundRow._data) || {}), id: foundRow.id, nom: foundRow.nom, prenom: foundRow.prenom } : {};
        patData   = p;
        // Résoudre cotationIdx si pas encore trouvé
        if (cotationIdx < 0 && Array.isArray(p.cotations)) {
          if (invNum)   cotationIdx = p.cotations.findIndex(c => c.invoice_number === invNum);
          if (cotationIdx < 0 && dateSoin) cotationIdx = p.cotations.findIndex(c => (c.date || '').slice(0, 10) === dateSoin);
        }
      }
    }
  } catch (_e) { console.warn('[editFromHist] IDB lookup:', _e?.message); }

  // ── Poser _editingCotation explicitement ───────────────────────────────
  // _userChose:true             → bypass garanti de la modale doublon (le user
  //                               a cliqué ✏️ → choix explicite, pas de modale)
  // _forceAttachToPatient:true  → si la cotation n'est pas dans cotations[]
  //                               du patient local (cas admin avec IDB
  //                               fraîchement synchronisée OU cotation créée
  //                               sur un autre device), forcer un push au
  //                               lieu du "ne rien faire" anti-doublon.
  //                               SAFE : n'agit que si patientId est connu
  //                               (donc le patient existe vraiment dans l'IDB).
  window._editingCotation = {
    patientId:             patientId,
    cotationIdx:           cotationIdx >= 0 ? cotationIdx : null,
    invoice_number:        invNum,
    _fromHist:             true,
    _userChose:            true,
    _forceAttachToPatient: !!patientId && cotationIdx < 0,
  };

  // ── Naviguer vers la page cotation ─────────────────────────────────────
  if (typeof navTo === 'function') navTo('cot', null);

  setTimeout(() => {
    // Construire le texte des actes pour le champ description
    const actes    = Array.isArray(data.actes) ? data.actes : [];
    const actesTxt = actes.map(a => {
      const code = a.code || '';
      const desc = a.description || a.label || a.nom || '';
      return desc ? `${code} ${desc}` : code;
    }).filter(Boolean).join(' + ') || '';

    const setV = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

    // Champ texte principal (actes)
    const fTxt = document.getElementById('f-txt');
    if (fTxt) {
      fTxt.value = actesTxt;
      if (typeof renderLiveReco === 'function') renderLiveReco(actesTxt);
      fTxt.focus();
    }

    // Date et heure du soin d'origine
    const fDs = document.getElementById('f-ds');
    const fHs = document.getElementById('f-hs');
    if (data.date_soin) {
      const _d = new Date(data.date_soin);
      if (fDs) fDs.value = _d.toISOString().slice(0, 10);
    }
    if (fHs) {
      // Toujours conserver l'heure d'origine — ne jamais laisser cotation.js
      // l'écraser avec l'heure actuelle lors d'une modification.
      fHs.value = (data.heure_soin || '').trim().slice(0, 5); // vide si non renseignée
      fHs._userEdited = true; // bloque l'écrasement par cotation.js dans tous les cas
    }

    // Données patient depuis l'IDB (si trouvées)
    // Fallback : si l'IDB ne retourne aucun nom (admin ou cotation sans fiche IDB),
    // utiliser patient_nom transmis depuis l'historique via data-hist-patnom.
    // Fonctionne pour admin ET nurse.
    if (!patData.nom && !patData.prenom && data.patient_nom) {
      const _parts = data.patient_nom.trim().split(/\s+/);
      // Convention : "Prénom NOM" → dernier mot = nom, reste = prénom
      patData.prenom = _parts.slice(0, -1).join(' ') || _parts[0] || '';
      patData.nom    = _parts.length > 1 ? _parts[_parts.length - 1] : '';
    }
    const nomComplet = ([patData.prenom, patData.nom].filter(Boolean).join(' ')).trim()
                    || data.patient_nom || '';
    setV('f-pt',  nomComplet  || '');
    setV('f-ddn', patData.ddn     || '');
    setV('f-amo', patData.amo     || '');
    setV('f-amc', patData.amc     || '');
    setV('f-exo', patData.exo     || '');
    setV('f-pr',  patData.medecin || '');

    // Badge patient
    if (nomComplet) {
      const badge     = document.getElementById('cot-patient-badge');
      const badgeText = document.getElementById('cot-patient-badge-text');
      if (badge && badgeText) {
        const ddnStr = patData.ddn ? ' — ' + new Date(patData.ddn).toLocaleDateString('fr-FR') : '';
        badgeText.textContent = '👤 ' + nomComplet + ddnStr;
        badge.style.display = 'flex';
      }
    }

    if (typeof showToast === 'function')
      showToast(`✏️ Cotation #${data.id} chargée — modifiez et recotez pour mettre à jour.`);
  }, 250);
}

/* Délégué d'événement pour les boutons ✏️ de l'historique */
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.hist-edit-btn');
  if (!btn) return;
  const data = {
    id:             btn.dataset.histId    || '',
    invoice_number: btn.dataset.histInv   || '',
    date_soin:      btn.dataset.histDate  || '',
    heure_soin:     btn.dataset.histHeure || '',
    patient_id:     btn.dataset.histPatid || '',
    patient_nom:    btn.dataset.histPatnom || '',
    actes:          (() => { try { return JSON.parse(decodeURIComponent(btn.dataset.histActes || '%5B%5D')); } catch { return []; } })(),
  };
  editFromHist(data);
});
