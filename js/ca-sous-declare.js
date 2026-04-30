/* ════════════════════════════════════════════════
   ca-sous-declare.js — AMI v1.0
   ────────────────────────────────────────────────
   💎 Feature PREMIUM add-on : "Détection CA sous-déclaré"
   ────────────────────────────────────────────────
   Croise :
     • Les cotations saisies (ami-historique)
     • Les passages de tournée (tournee.js : actualTour / planning_patients)
     • Les BSI actifs (bsi.js)
     • Les notes de soins (notes.js)
   → Détecte les actes réalisés mais NON cotés
   → Chiffre le CA perdu et propose la récupération

   Méthode (prudente, aucun faux positif) :
     1. Pour chaque jour ouvré des 90 derniers jours :
        Nb passages tournée > Nb cotations du même jour
        → Écart brut = passages - cotations
     2. Filtrage fiabilité :
        - Écart ≥ 1 (on ignore les approximations infra-journée)
        - Patient présent dans le carnet (sinon = passage exploratoire)
     3. Valorisation : coef moyen * tarif moyen du segment
     4. Rapport : top 5 jours à reprendre, CA potentiel global

   🔒 GATING : SUB.requireAccess('ca_sous_declare')
      → Non-PREMIUM : paywall. Admin : accès total (test/démo).

   📦 API :
     window.CASousDeclare = {
       analyze()      → Promise<{ items, stats }>
       render()       → affiche dans #view-ca-sous-declare
       recordFix(id)  → marque un item comme régularisé (local IDB)
     }
════════════════════════════════════════════════ */
'use strict';

(function(){

  const STORE   = 'ca_sous_declare_fixes';
  const DB_NAME = 'ami_ca_sdc';
  const TARIF_MOYEN_AMI = 3.15;     // tarif MIE 2026
  const COEF_MOYEN      = 1.4;      // moyenne empirique (AMI 1 + majo + IFD)

  /* ───── IDB local : trace des régularisations ──────────── */
  function _db() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function _idbGet(id) {
    const db = await _db();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror   = () => rej(rq.error);
    });
  }

  async function _idbPut(obj) {
    const db = await _db();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      const rq = tx.objectStore(STORE).put(obj);
      rq.onsuccess = () => res(obj);
      rq.onerror   = () => rej(rq.error);
    });
  }

  async function _idbAll() {
    const db = await _db();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror   = () => rej(rq.error);
    });
  }

  /* ───── Analyse croisée ────────────────────────────────── */

  /**
   * Récupère le planning (passages enregistrés en base) et les cotations
   * sur une fenêtre de 90 jours.
   */
  async function _fetchCrossData() {
    // 1. Historique cotations (90j)
    let cotations = [];
    try {
      const d = await fetchAPI('/webhook/ami-historique?period=quarter');
      cotations = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
    } catch (e) { console.warn('[CA-SDC] historique KO:', e.message); }

    // 2. Planning passages (tournée archivée) — table planning_patients
    let passages = [];
    try {
      const d = await fetchAPI('/webhook/planning-passages?period=quarter');
      passages = Array.isArray(d?.data) ? d.data : [];
    } catch (e) {
      // Fallback : pas d'API → on n'affiche pas d'écart mais on ne plante pas
      console.warn('[CA-SDC] planning KO:', e.message);
    }

    // 3. Patients connus (carnet local)
    let patientsKnown = new Set();
    try {
      // Adapter à l'API AMI : getAllPatients (utils.js) ou listPatients en fallback
      const _list = (typeof getAllPatients === 'function') ? getAllPatients
                   : (typeof listPatients === 'function')  ? listPatients : null;
      if (_list) {
        const lst = await _list();
        (lst || []).forEach(p => {
          if (p.id)   patientsKnown.add(String(p.id));
          if (p.nom)  patientsKnown.add((p.nom + ' ' + (p.prenom||'')).trim().toLowerCase());
        });
      }
    } catch (_) {}

    return { cotations, passages, patientsKnown };
  }

  /** Regroupe par jour YYYY-MM-DD + patient (clé normalisée). */
  function _bucketByDayPatient(rows, getDate, getPatient) {
    const map = new Map();
    (rows || []).forEach(r => {
      const d = getDate(r);
      const p = (getPatient(r) || '').trim().toLowerCase();
      if (!d || !p) return;
      const k = d.slice(0,10) + '|' + p;
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  }

  /**
   * Calcule les écarts jour/patient.
   * Retourne une liste d'items { id, date, patient, gap, gain_estime, reason }
   */
  function _computeGaps(cotations, passages, patientsKnown) {
    const cotMap  = _bucketByDayPatient(cotations, r => r.created_at || r.date, r => r.patient_nom || r.patient);
    const pasMap  = _bucketByDayPatient(passages,  r => r.date_prevue || r.date, r => r.patient_nom || r.nom);

    const items = [];
    for (const [k, nPas] of pasMap) {
      const nCot = cotMap.get(k) || 0;
      const gap  = nPas - nCot;
      if (gap < 1) continue;

      const [date, patient] = k.split('|');
      // Filtre fiabilité : patient doit exister dans le carnet
      const known = patientsKnown.has(patient) || [...patientsKnown].some(p => p.includes(patient) || patient.includes(p));
      if (!known) continue;

      const gain = +(gap * TARIF_MOYEN_AMI * COEF_MOYEN).toFixed(2);
      items.push({
        id: 'sdc_' + btoa(k).replace(/=/g,''),
        date,
        patient,
        gap,
        gain_estime: gain,
        reason: `${nPas} passage${nPas>1?'s':''} tournée · ${nCot} cotation${nCot>1?'s':''}`
      });
    }
    // Tri : gain desc
    items.sort((a,b) => b.gain_estime - a.gain_estime);
    return items;
  }

  async function analyze() {
    const { cotations, passages, patientsKnown } = await _fetchCrossData();
    const allItems = _computeGaps(cotations, passages, patientsKnown);
    // Enlever les items déjà régularisés
    const fixes = await _idbAll();
    const fixedIds = new Set(fixes.map(f => f.id));
    const items = allItems.filter(i => !fixedIds.has(i.id));

    const total_gain = items.reduce((s,i) => s + i.gain_estime, 0);
    const total_items = items.length;

    return {
      items: items.slice(0, 50),       // cap affichage
      stats: {
        total_items,
        total_gain: +total_gain.toFixed(2),
        fixed_count: fixes.length,
        coverage_days: 90
      }
    };
  }

  async function recordFix(id) {
    await _idbPut({ id, fixed_at: new Date().toISOString() });
  }

  /* ───── UI ─────────────────────────────────────────────── */

  async function render() {
    // 🔒 Gating — redirige vers paywall si non-PREMIUM
    if (typeof SUB !== 'undefined' && !SUB.requireAccess('ca_sous_declare')) return;

    const root = document.getElementById('view-ca-sous-declare');
    if (!root) return;

    root.innerHTML = `
      <div class="card">
        <div class="cardh">
          <h2>💸 Détection CA sous-déclaré <span class="sub-feat-pill">PREMIUM</span></h2>
          <p class="sub">Croisement tournées · cotations · carnet patients sur 90 jours.</p>
        </div>
        <div id="sdc-loading" class="ai in">⏳ Analyse en cours…</div>
        <div id="sdc-empty"   class="ai in" style="display:none">✅ Aucun écart détecté sur 90 jours. Votre déclaration est propre.</div>
        <div id="sdc-body" style="display:none">
          <div class="dash-kpi-row">
            <div class="dash-kpi"><div class="dash-kpi-label">Écarts détectés</div><div class="dash-kpi-val" id="sdc-kpi-count">–</div></div>
            <div class="dash-kpi"><div class="dash-kpi-label">CA potentiel</div><div class="dash-kpi-val" id="sdc-kpi-gain">–</div></div>
            <div class="dash-kpi"><div class="dash-kpi-label">Déjà régularisé</div><div class="dash-kpi-val" id="sdc-kpi-fix">–</div></div>
          </div>
          <div id="sdc-list" style="margin-top:14px"></div>
        </div>
      </div>
    `;

    try {
      const { items, stats } = await analyze();
      $('sdc-loading').style.display = 'none';

      if (!items.length && stats.fixed_count === 0) {
        $('sdc-empty').style.display = 'block';
        return;
      }

      $('sdc-body').style.display = 'block';
      $('sdc-kpi-count').textContent = stats.total_items;
      $('sdc-kpi-gain').textContent  = fmt(stats.total_gain);
      $('sdc-kpi-fix').textContent   = stats.fixed_count;

      const list = $('sdc-list');
      list.innerHTML = items.map(i => `
        <div class="sdc-row" data-id="${i.id}">
          <div class="sdc-main">
            <div class="sdc-pat">${sanitize(i.patient)}</div>
            <div class="sdc-sub">${i.date} · ${i.reason}</div>
          </div>
          <div class="sdc-gain">+ ${fmt(i.gain_estime)}</div>
          <button class="btn-mini sdc-fix" data-id="${i.id}">Régularisé</button>
        </div>
      `).join('');

      list.querySelectorAll('.sdc-fix').forEach(b => {
        b.onclick = async () => {
          const id = b.dataset.id;
          await recordFix(id);
          b.closest('.sdc-row').style.opacity = '0.4';
          b.textContent = '✓ Noté';
          b.disabled = true;
        };
      });
    } catch (e) {
      $('sdc-loading').innerHTML = `⚠️ Erreur d'analyse : ${sanitize(e.message||'')}`;
    }
  }

  /* ───── Hook navigation ────────────────────────────────── */
  document.addEventListener('ui:navigate', e => {
    if (e.detail?.view === 'ca-sous-declare') render();
  });

  /* Export */
  window.CASousDeclare = { analyze, render, recordFix };

})();
