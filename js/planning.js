/* ════════════════════════════════════════════════════════════════════════
   planning.js — AMI NGAP — Planning hebdomadaire
   ────────────────────────────────────────────────────────────────────────
   Extrait de tournee.js le 2026-04-23 — module dédié au Planning hebdo.
   ─ Persistance localStorage (clé isolée par utilisateur)
   ─ Sync chiffrée navigateur ↔ serveur (table weekly_planning)
   ─ Vue solo + vue cabinet multi-IDE (clustering géo)
   ─ Navigation hebdomadaire + assignations IDE + suppression patient

   Dépendances (résolues globalement à l'exécution depuis utils.js / tournee.js
   / cabinet.js — pas d'import nécessaire grâce au scope global du <script>) :
      APP, S, $, wpost, _enc, _dec, _idbGetAll, PATIENTS_STORE, showToast,
      _enrichSoinLabel, _localDateStr, cabinetGeoCluster, smartCluster,
      apiCall, ld, estimateRevenue (← reste dans tournee.js)

   ⚠️ Charger ce fichier APRÈS tournee.js dans index.html.
════════════════════════════════════════════════════════════════════════ */

/* ── Recharger le planning hebdomadaire quand on navigue vers la vue "pla" */
const _onNavPla = e => {
  if (e.detail?.view === 'pla') {
    setTimeout(() => {
      _planningInitCabinetUI();
      _restorePlanningIfNeeded();
    }, 100);
  }
};
document.addEventListener('app:nav',     _onNavPla);
document.addEventListener('ui:navigate', _onNavPla);

/* ══════════════════════════════════════════════════════
   PLANNING HEBDOMADAIRE — PERSISTANCE localStorage
   Clé isolée par utilisateur : ami_planning_<userId>
   Conserve les données entre sessions et imports
   ══════════════════════════════════════════════════════ */
function _planningKey() {
  // Priorité 1 : S en mémoire (déjà hydraté)
  let uid = (typeof S !== 'undefined' && S?.user?.id) ? S.user.id : null;
  // Priorité 2 : sessionStorage clé 'ami' (celle utilisée par ss.save/load dans utils.js)
  if (!uid) {
    try {
      const sess = JSON.parse(sessionStorage.getItem('ami') || 'null');
      uid = sess?.user?.id || null;
    } catch {}
  }
  uid = uid || 'local';
  return 'ami_planning_' + String(uid).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function _savePlanning(patients) {
  try {
    const key = _planningKey();
    // ⚡ Fixer la date d'assignation sur chaque patient qui n'en a pas encore
    // → sans ça, la date par défaut serait recalculée à chaque renderPlanning (= glissement quotidien)
    const todayFixed = new Date().toISOString().split('T')[0];
    const patientsWithDate = patients.map(p => {
      if (p.date || p.date_soin || p.date_prevue) return p;
      return { ...p, date: todayFixed, _dateFixed: true };
    });
    const data = { patients: patientsWithDate, savedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(data));
  } catch(e) { console.warn('[Planning] Save KO:', e.message); }
}

function _loadPlanning() {
  try {
    const key = _planningKey();
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // TTL 7 jours
    if (Date.now() - (data.savedAt || 0) > 7 * 24 * 3600 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return Array.isArray(data.patients) ? data.patients : null;
  } catch { return null; }
}

function _clearPlanning() {
  try { localStorage.removeItem(_planningKey()); } catch {}
}

/* Sauvegarder le planning chaque fois que les données changent */
function _syncPlanningStorage() {
  // Source : _planningData en priorité (source de vérité pour renderPlanning)
  const patients = window.APP._planningData?.patients
    || APP.importedData?.patients
    || APP.importedData?.entries
    || [];
  if (patients.length) {
    _savePlanning(patients);
    _syncPlanningToServer(patients).catch(() => {});
  }
}

/* ════════════════════════════════════════════════════════════════════════
   SYNC PLANNING HEBDOMADAIRE — navigateur ↔ mobile
   Blob AES-256 chiffré côté client — le worker stocke sans déchiffrer.
   Table weekly_planning : 1 ligne / infirmiere_id (upsert).
════════════════════════════════════════════════════════════════════════ */
async function _syncPlanningToServer(patients) {
  if (typeof S === 'undefined' || !S?.token) return;
  try {
    let encrypted_data;
    if (typeof _enc === 'function') {
      try { encrypted_data = _enc({ __weekly_planning: patients }); } catch { encrypted_data = JSON.stringify(patients); }
    } else {
      encrypted_data = JSON.stringify(patients);
    }
    await wpost('/webhook/planning-push', { encrypted_data, updated_at: new Date().toISOString() });
  } catch (e) { console.warn('[AMI] Planning push KO (silencieux):', e.message); }
}

// Flag positionné à true après un effacement volontaire — bloque la re-sync serveur
let _planningManuallyCleared = false;

async function _syncPlanningFromServer() {
  if (typeof S === 'undefined' || !S?.token) return;
  // Ne pas restaurer depuis le serveur si l'utilisateur vient d'effacer volontairement
  if (_planningManuallyCleared) return;
  try {
    const res = await wpost('/webhook/planning-pull', {});
    if (!res?.ok || !res.data?.encrypted_data) return;

    let remote = null;
    try {
      if (typeof _dec === 'function') {
        const d = _dec(res.data.encrypted_data);
        remote = d?.__weekly_planning || null;
      }
      if (!remote) remote = JSON.parse(res.data.encrypted_data);
    } catch {}
    if (!Array.isArray(remote) || !remote.length) return;

    // Utiliser les données distantes seulement si le local est vide
    // (la version locale fait foi si elle existe — évite d'écraser un travail en cours)
    const localSaved = _loadPlanning();
    if (!localSaved || !localSaved.length) {
      _savePlanning(remote);
      window.APP._planningData = { patients: remote, total: remote.length, source: 'planning_serveur' };
      _renderPlanningIfVisible();
      console.info('[AMI] Planning sync depuis serveur :', remote.length, 'patient(s)');
    } else {
      // Fusion : ajouter les entrées distantes absentes localement (par id)
      const localIds = new Set(localSaved.map(p => p.id || p.patient_id || ''));
      const toAdd = remote.filter(p => {
        const pid = p.id || p.patient_id || '';
        return pid && !localIds.has(pid);
      });
      if (toAdd.length) {
        const merged = [...localSaved, ...toAdd];
        _savePlanning(merged);
        window.APP._planningData = { patients: merged, total: merged.length, source: 'planning_fusionné' };
        _renderPlanningIfVisible();
        console.info('[AMI] Planning fusion :', toAdd.length, 'patient(s) ajouté(s) depuis le serveur');
      }
    }
  } catch (e) { console.warn('[AMI] Planning pull KO:', e.message); }
}

/* Écoute réactive : sauvegarde automatique quand APP.importedData change */
document.addEventListener('app:update', e => {
  if (e.detail.key !== 'importedData') return;
  const d = e.detail.value;
  // ⚡ Flag posé par _planningImportDayToTournee : on importe les patients
  // d'un seul jour vers la Tournée → ne PAS écraser _planningData (qui contient
  // toute la semaine du Planning hebdomadaire).
  if (d?._skipPlanningSync) return;
  if (d?.patients?.length || d?.entries?.length) {
    const pats = d.patients || d.entries;
    // Maintenir _planningData en sync avec importedData
    window.APP._planningData = { patients: pats, total: pats.length, source: 'import' };
    _savePlanning(pats);
  }
});

/* Restauration du planning au login (après hydratation de S = bonne clé userId) */
document.addEventListener('ami:login', () => {
  setTimeout(() => {
    _restorePlanningIfNeeded();
    // Sync depuis le serveur après restauration locale (navigateur ↔ mobile)
    setTimeout(() => _syncPlanningFromServer().catch(() => {}), 800);
  }, 200);
});

/* ⚡ Purge du state planning au logout pour éviter les fuites cross-utilisateur.
   La purge des autres états (uberPatients, IDE assignments, etc.) reste dans
   tournee.js — ici on ne touche qu'aux choses planning. */
document.addEventListener('ami:logout', () => {
  try {
    window.APP._planningData = null;
  } catch(e) {
    console.warn('[Planning] logout cleanup:', e.message);
  }
});

/* Restaurer APP.importedData depuis le planning sauvegardé si vide */
function _restorePlanningIfNeeded() {
  // Ne JAMAIS écrire dans APP.importedData depuis ici :
  // importedData = tournée du jour (vide au login).
  // Le planning hebdomadaire est stocké séparément dans APP._planningData.
  const saved = _loadPlanning();
  if (saved?.length) {
    window.APP._planningData = { patients: saved, total: saved.length, source: 'planning_sauvegardé' };
  }
  _renderPlanningIfVisible();
}

/* Rendre le planning uniquement si la vue pla est actuellement visible */
function _renderPlanningIfVisible() {
  const view = document.getElementById('view-pla');
  if (!view || !view.classList.contains('on')) return;
  const patients = window.APP._planningData?.patients
    || APP.importedData?.patients
    || APP.state?.importedData?.patients || [];
  if (!patients.length) return;
  renderPlanning({}).catch(() => {});
}

/* Actualiser le planning manuellement (bouton Actualiser dans view-pla) */
function refreshPlanning() {
  _planningInitCabinetUI(); // mettre à jour toggle cabinet
  _restorePlanningIfNeeded();
  const patients = window.APP._planningData?.patients
    || APP.importedData?.patients || APP.importedData?.entries
    || APP.state?.importedData?.patients || [];
  if (patients.length) {
    renderPlanning({}).catch(() => {});
  } else {
    const pbody = document.getElementById('pbody');
    if (pbody) pbody.innerHTML = '<div class="ai in" style="margin-top:12px">Aucune donnée disponible. Importez un planning depuis "Import calendrier" ou saisissez manuellement.</div>';
    const resPla = document.getElementById('res-pla');
    if (resPla) resPla.classList.add('show');
    if (typeof showToast === 'function') showToast('ℹ️ Aucune donnée à charger.', 'ok');
  }
}

/* ════════════════════════════════════════════════
   PLANNING HEBDOMADAIRE CABINET — variables d'état
════════════════════════════════════════════════ */
let _planningWeekOffset = 0; // 0 = semaine courante, -1 = précédente, +1 = suivante

// ⚡ Cabinet mode : TOUJOURS lire/écrire localStorage directement
// Élimine tout risque de variable JS stale entre renders async
function _getCabinetMode() {
  try { return localStorage.getItem('ami_planning_cabinet_mode') === '1'; } catch { return false; }
}
function _setCabinetMode(v) {
  try { localStorage.setItem('ami_planning_cabinet_mode', v ? '1' : '0'); } catch {}
}
// Compatibilité rétro — alias vers les fonctions (lecture seule désormais)
Object.defineProperty(window, '_planningCabinetMode', {
  get() { return _getCabinetMode(); },
  set(v) { _setCabinetMode(v); },
  configurable: true,
});

/** Naviguer d'une semaine en avant/arrière */
function planningWeekNav(delta) {
  _planningWeekOffset += delta;
  refreshPlanning();
}

/** Activer / désactiver la vue cabinet */
function planningToggleCabinetView(active) {
  _setCabinetMode(!!active);

  refreshPlanning();
}

/** Affiche ou masque le toggle cabinet selon APP.cabinet */
function _planningInitCabinetUI() {
  const wrap   = document.getElementById('pla-cabinet-toggle-wrap');
  const btnCab = document.getElementById('btn-pla-cabinet');
  const cab    = typeof APP !== 'undefined' && APP.get ? APP.get('cabinet') : null;
  const hasCab = !!(cab?.id);

  const _cabMode = _getCabinetMode();
  if (wrap) {
    if (hasCab || _cabMode) wrap.style.display = 'block';
    else wrap.style.display = 'none';
    const label = wrap.querySelector('label');
    if (label) { label.style.opacity = '1'; label.title = ''; }
    const cb = wrap.querySelector('input[type=checkbox]');
    if (cb) cb.disabled = false;
    // NE PAS toucher cb.checked par code
  }
  if (btnCab) btnCab.style.display = (hasCab || _cabMode) ? 'inline-flex' : 'none';

  if (!hasCab && !window._planningCabinetInitDone) {
    setTimeout(() => {
      const cabRetry = typeof APP !== 'undefined' && APP.get ? APP.get('cabinet') : null;
      if (cabRetry?.id) {
        _planningCabinetInitDone = true;
        _planningInitCabinetUI();
        if (_getCabinetMode()) renderPlanning({}).catch(() => {});
      }
    }, 1000);
  }
}

let _planningCabinetInitDone = false;
/** Réagir aux changements de cabinet */
if (typeof APP !== 'undefined' && APP.on) {
  APP.on('cabinet', () => { _planningCabinetInitDone = true; _planningInitCabinetUI(); });
}
window._planningInitCabinetUI = _planningInitCabinetUI;

/** Génère et affiche un planning multi-IDE depuis les patients importés */
async function planningGenerateCabinet() {
  const patients = window.APP._planningData?.patients
    || APP.importedData?.patients
    || APP.importedData?.entries || [];
  if (!patients.length) {
    if (typeof showToast === 'function') showToast('Aucun patient à répartir.', 'wa');
    return;
  }
  const cab = APP.get ? APP.get('cabinet') : null;
  if (!cab?.id) {
    if (typeof showToast === 'function') showToast('Vous n\'êtes pas dans un cabinet.', 'wa');
    return;
  }
  // Activer automatiquement le mode cabinet et re-rendre
  _setCabinetMode(true);
  const cb = document.getElementById('pla-cabinet-mode');
  if (cb) cb.checked = true;
  renderPlanning({}).catch(() => {});
}

async function generatePlanningFromImport(){
  if(!APP.importedData){alert('Aucune donnée importée. Utilisez le Carnet patients ou l\'Import calendrier.');return;}
  const patients=APP.importedData.patients||APP.importedData.entries||[];
  if(!patients.length){alert('Aucun patient dans les données importées.');return;}
  // Construire un texte structuré depuis l'import
  const txt=patients.map((p,i)=>{
    // ⚡ Enrichir avant envoi IA — "Diabète" seul ne génère pas d'actes NGAP.
    // Avec l'enrichissement, l'IA reçoit "Injection insuline SC, surveillance
    // glycémie capillaire, éducation thérapeutique" et peut coter correctement.
    const desc = (typeof _enrichSoinLabel === 'function')
      ? _enrichSoinLabel({
          actes_recurrents: p.actes_recurrents || '',
          pathologies:      p.pathologies || '',
          description:      p.description || p.texte || p.summary || '',
        }, 180)
      : (p.description||p.texte||p.summary||'Soin infirmier');
    const freq=p.frequence||p.recurrence||'quotidien';
    return `Patient P${i+1} : ${desc||'Soin infirmier'} (${freq})`;
  }).join('\n');
  $('pl-txt').value=txt;
  ld('btn-pla',true);
  $('res-pla').classList.remove('show');
  try{
    const d=await apiCall('/webhook/ami-calcul',{mode:'planning',texte:txt});
    renderPlanning(d).catch(()=>{});
    $('perr').style.display='none';
  }catch(e){$('perr').style.display='flex';$('perr-m').textContent=e.message;}
  $('res-pla').classList.add('show');
  ld('btn-pla',false);
  // ⚡ FIX glissement : modeAI('planning') écrit APP.importedData.patients par
  // assignation directe → l'event listener app:update ne se déclenche jamais →
  // _savePlanning() n'est pas appelé → la date n'est jamais figée. On force ici
  // la sauvegarde pour que chaque patient sans date reçoive date: todayFixed.
  try {
    const allPats = APP.importedData?.patients || APP.importedData?.entries || [];
    if (allPats.length) {
      window.APP._planningData = { patients: allPats, total: allPats.length, source: 'planning_genere' };
      _savePlanning(allPats);
    }
  } catch(e) { console.warn('[Planning] fix-date save KO:', e.message); }
}

/* ════════════════════════════════════════════════
   GUARD CABINET — source de vérité centralisée
════════════════════════════════════════════════ */
function _getCabinetReadyState() {
  const cab = APP.get ? APP.get('cabinet') : null;
  return {
    exists:     !!(cab?.id),
    hasMembers: !!(cab?.members && cab.members.length),
    ready:      !!(cab?.id && cab?.members && cab.members.length),
    members:    cab?.members || [],
    cab,
  };
}

async function renderPlanning(d){
  // ── Initialiser UI cabinet ──────────────────────────────────────────────
  _planningInitCabinetUI();

  // ── Patients source ─────────────────────────────────────────────────────
  const rawPatients = window.APP._planningData?.patients
    || APP.importedData?.patients
    || APP.importedData?.entries
    || [];
  const ca = rawPatients.length ? estimateRevenue(rawPatients) : null;

  // ── Calcul des dates de la semaine affichée ──────────────────────────────
  const today      = new Date();
  const dayOfWeek  = today.getDay(); // 0=dim, 1=lun…
  const mondayThis = new Date(today);
  mondayThis.setDate(today.getDate() - ((dayOfWeek + 6) % 7) + _planningWeekOffset * 7);
  mondayThis.setHours(0, 0, 0, 0);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d2 = new Date(mondayThis);
    d2.setDate(mondayThis.getDate() + i);
    return d2;
  });

  // Mettre à jour le label de semaine
  const labelEl = document.getElementById('pla-week-label');
  if (labelEl) {
    if (_planningWeekOffset === 0) {
      labelEl.textContent = 'Cette semaine';
    } else if (_planningWeekOffset === 1) {
      labelEl.textContent = 'Semaine prochaine';
    } else if (_planningWeekOffset === -1) {
      labelEl.textContent = 'Semaine dernière';
    } else {
      const d1s = weekDates[0].toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
      const d7s = weekDates[6].toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
      labelEl.textContent = `${d1s} – ${d7s}`;
    }
  }

  // ⚡ Date locale (pas UTC) — évite le décalage timezone (ex: lundi 23h FR = mardi UTC)
  const todayISO = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  // ── Enrichir depuis le carnet patient (IDB) par patient_id ──────────────
  let carnetIndex = {};
  try {
    if (typeof _idbGetAll === 'function') {
      const rows = await _idbGetAll(PATIENTS_STORE);
      rows.forEach(r => {
        const decoded = (typeof _dec === 'function') ? (_dec(r._data) || {}) : {};
        carnetIndex[r.id] = { nom: r.nom || '', prenom: r.prenom || '', ...decoded };
      });
    }
  } catch(e) { console.warn('[Planning] IDB KO:', e.message); }

  // ── Enrichir depuis uberPatients ─────────────────────────────────────────
  const uberIndex = {};
  (APP.get('uberPatients') || []).forEach(p => {
    const k = p.patient_id || p.id;
    if (k) uberIndex[k] = p;
  });

  // ── Construire la liste enrichie ──────────────────────────────────────────
  const patients = rawPatients.map((p, idx) => {
    const pid   = p.patient_id || p.id || '';
    const fiche = carnetIndex[pid] || {};
    const uber  = uberIndex[pid]   || {};

    const nomFiche  = [fiche.prenom, fiche.nom].filter(Boolean).join(' ').trim();
    const nomDirect = [p.prenom, p.nom].filter(Boolean).join(' ').trim();
    const nomUber   = [uber.prenom, uber.nom].filter(Boolean).join(' ').trim();
    let nom = nomFiche || nomDirect || nomUber;

    if (!nom) {
      const raw = (p.description || p.texte || '').trim();
      const sep = raw.match(/^([^—\-:]+?)(?:\s*[—\-:]\s*|\s+(?:injection|pansement|toilette|prélèvement|perfusion|insuline|soin\s|bilan|visite|acte\s))/i);
      if (sep && sep[1].trim().length > 1) {
        nom = sep[1].trim();
      } else {
        const nameW = [];
        for (const w of raw.split(/\s+/).slice(0, 4)) {
          if (/^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜÇ]/.test(w)) nameW.push(w); else break;
        }
        nom = nameW.length >= 2 ? nameW.join(' ') : '';
      }
    }

    // ⚡ La date est fixée au moment de la sauvegarde (_savePlanning).
    // Ne jamais substituer todayISO ici : sinon le patient glisse chaque jour.
    const date = p.date || p.date_soin || p.date_prevue || null;

    return {
      ...p,
      nom:              (fiche.nom    || p.nom    || uber.nom    || '').trim(),
      prenom:           (fiche.prenom || p.prenom || uber.prenom || '').trim(),
      _nomAff:          nom || 'Patient',
      date,
      actes_recurrents: fiche.actes_recurrents || p.actes_recurrents || '',
      _cotation:        p._cotation || uber._cotation,
      done:             p.done   || p._done   || uber.done   || false,
      absent:           p.absent || p._absent || uber.absent || false,
      _planIdx:         idx,
    };
  });

  // ── Filtrer par semaine affichée ──────────────────────────────────────────
  const weekStart = weekDates[0];
  const weekEnd   = weekDates[6];
  const patientsThisWeek = patients.filter(p => {
    // ⚡ Si pas de date fixée → inclure dans la semaine courante uniquement
    if (!p.date) return _planningWeekOffset === 0;
    try {
      const pd = new Date(p.date);
      // ⚡ new Date(null) = epoch (Thu Jan 01 1970), pd.getTime() === 0 → considérer comme sans date
      if (isNaN(pd) || pd.getTime() === 0) return _planningWeekOffset === 0;
      return pd >= weekStart && pd <= weekEnd;
    } catch { return true; }
  });
  // Si la semaine filtrée est vide et qu'on est sur la semaine courante → afficher tous
  const patientsToShow = (patientsThisWeek.length === 0 && _planningWeekOffset === 0)
    ? patients
    : patientsThisWeek;

  // ── Distribution par jour de la semaine ──────────────────────────────────
  const JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  const byDay = {};
  JOURS.forEach((j, i) => { byDay[j] = { label: j, date: weekDates[i], patients: [] }; });

  patientsToShow.forEach((p, listIdx) => {
    let jourKey = null;
    // ⚡ FIX glissement : new Date(null) renvoie Thu Jan 01 1970 (jeudi),
    // pas une date invalide. Sans ce garde, tous les patients sans date
    // sont silencieusement collés sur "jeudi" (effet visible quand le jour
    // courant tombe un jeudi : illusion que les patients ont "glissé" sur aujourd'hui).
    if (p.date) {
      try {
        const pd = new Date(p.date);
        if (!isNaN(pd) && pd.getTime() !== 0) {
          const nomJour = pd.toLocaleDateString('fr-FR', { weekday: 'long' }).toLowerCase();
          jourKey = JOURS.find(j => nomJour.startsWith(j)) || null;
        }
      } catch {}
    }
    if (!jourKey) {
      const desc = (p.description || p.texte || '').toLowerCase();
      jourKey = JOURS.find(j => desc.includes(j)) || null;
    }
    // ⚡ Fallback stable : hash basé sur patient_id/nom, pas sur listIdx (qui change)
    if (!jourKey) {
      const stableKey = (p.patient_id || p.id || p.nom || String(listIdx));
      let hash = 0;
      for (let ci = 0; ci < stableKey.length; ci++) hash = (hash * 31 + stableKey.charCodeAt(ci)) & 0x7fffffff;
      jourKey = JOURS[hash % JOURS.length];
    }
    byDay[jourKey].patients.push(p);
  });

  // ⚡ Cache global : permet au bouton "📥 Tournée" sur chaque jour de
  // récupérer la liste des patients sans avoir à dupliquer la logique de
  // résolution de jour (resolveJour, dates, fallback hash). Mis à jour à
  // chaque render → toujours cohérent avec ce qui est affiché.
  window._planningByDay = byDay;

  // ── Cabinet : calcul répartition multi-IDE ───────────────────────────────
  const cab = APP.get ? APP.get('cabinet') : null;

  // ⚡ Lecture DIRECTE localStorage — source de vérité absolue, zéro variable stale
  const cabinetActive = _getCabinetMode();
  if (cabinetActive && !cab?.id) {
    // Cabinet pas encore chargé → retry silencieux
    setTimeout(() => {
      const cabRetry = APP.get ? APP.get('cabinet') : null;
      if (cabRetry?.id) renderPlanning({}).catch(() => {});
    }, 800);
  }
  // patientsForCabinet déclaré ici (scope renderPlanning) → accessible dans renderCabinetView()
  const patientsForCabinet = patients.length ? patients : patientsToShow;
  let cabinetAssignments = {};

  if (cabinetActive) {
    const cabNow = APP.get ? APP.get('cabinet') : null;
    const cabMembers = cabNow?.members?.length ? cabNow.members : null;

    // ⚡ Pas de early return — renderCabinetView() gère l'état "membres pas encore chargés"
    // Si membres pas disponibles → retry dans 600ms, cabinetAssignments reste vide → spinner
    if (!cabMembers) {
      setTimeout(() => renderPlanning({}).catch(() => {}), 600);
      // cabinetAssignments reste {} → renderCabinetView affichera le spinner
    } else {
      // ✅ Membres disponibles → distribuer les patients
      const effectiveMembers = cabMembers;
    const COLORS = ['#00d4aa','#4fa8ff','#ff9f43','#ff6b6b','#a29bfe'];
    effectiveMembers.forEach((m, i) => {
      const ideId = m.id || m.infirmiere_id || `ide_${i}`;
      cabinetAssignments[ideId] = {
        nom:      m.nom    || '',
        prenom:   m.prenom || `IDE ${i+1}`,
        role:     m.role   || 'membre',
        patients: [],
        color:    COLORS[i % 5],
      };
    });
      // Helper : récupère la liste des IDEs assignés manuellement à un patient
      // (rétrocompat : _assignedIde singleton → converti en liste)
      const _getAssignedIdes = (p) => {
        if (Array.isArray(p._assignedIdes) && p._assignedIdes.length) return p._assignedIdes;
        if (p._assignedIde) return [p._assignedIde];
        return [];
      };

      // Patients avec au moins une assignation manuelle valide
      const patsWithManual = patientsForCabinet.filter(p => {
        const ides = _getAssignedIdes(p);
        return ides.some(id => cabinetAssignments[id]);
      });
      // Patients sans assignation → clustering auto
      const patsNeedsClustering = patientsForCabinet.filter(p => {
        const ides = _getAssignedIdes(p);
        return !ides.some(id => cabinetAssignments[id]);
      });

      // Distribuer les patients manuels : un patient peut apparaître dans PLUSIEURS IDEs
      patsWithManual.forEach(p => {
        _getAssignedIdes(p).forEach(ideId => {
          if (cabinetAssignments[ideId]) cabinetAssignments[ideId].patients.push(p);
        });
      });

      if (patsNeedsClustering.length && typeof cabinetGeoCluster === 'function') {
        const clusters = cabinetGeoCluster(patsNeedsClustering, effectiveMembers.length);
        effectiveMembers.forEach((m, i) => {
          const ideId = m.id || m.infirmiere_id || `ide_${i}`;
          (clusters[i] || []).forEach(p => cabinetAssignments[ideId].patients.push(p));
        });
      } else if (patsNeedsClustering.length) {
        patsNeedsClustering.forEach((p, i) => {
          const ideId = Object.keys(cabinetAssignments)[i % effectiveMembers.length];
          if (cabinetAssignments[ideId]) cabinetAssignments[ideId].patients.push(p);
        });
      }
    } // fin else (membres chargés)
  } // fin if (cabinetActive)

  // ── KPIs semaine ─────────────────────────────────────────────────────────
  const totalCot = patientsToShow.reduce((s, p) => s + (p._cotation?.validated ? (p._cotation.total||0) : 0), 0);
  const nbCot    = patientsToShow.filter(p => p._cotation?.validated).length;
  const caWeek   = ca ? ca * (patientsToShow.length / Math.max(patients.length, 1)) : null;

  // ── Rendu carte patient (solo) ────────────────────────────────────────────
  function renderPatientCard(p, ideColor) {
    const nom     = p._nomAff || [p.prenom, p.nom].filter(Boolean).join(' ') || 'Patient';
    const date    = p.date || todayISO;
    let dateAff   = '';
    try {
      const d2 = new Date(date);
      if (!isNaN(d2)) dateAff = d2.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
    } catch {}
    const heure   = p.heure_soin || p.heure_preferee || p.heure || '';
    const actes   = (p.actes_recurrents || '').trim();
    // ⚡ Utiliser _enrichSoinLabel pour que "Diabète" ou "HTA" bruts soient
    // convertis en description détaillée d'actes NGAP ("Injection insuline SC,
    // surveillance glycémie capillaire, éducation thérapeutique"). Sinon le
    // Planning hebdo affichait juste "Diabète" alors que la cotation et
    // l'Historique montraient le détail — incohérence visuelle.
    let soin = (typeof _enrichSoinLabel === 'function')
      ? _enrichSoinLabel({
          actes_recurrents: p.actes_recurrents || '',
          pathologies:      p.pathologies || '',
          description:      p.description || p.texte || '',
        }, 120)
      : (actes || (p.description || p.texte || '').trim());
    if (!actes && nom !== 'Patient' && soin.toLowerCase().startsWith(nom.toLowerCase())) {
      soin = soin.slice(nom.length).replace(/^\s*[—\-:]\s*/, '').trim();
    }
    soin = soin.slice(0, 80);
    const cot     = p._cotation?.validated;
    const idx     = p._planIdx;
    const borderL = ideColor ? `border-left:3px solid ${ideColor};` : '';

    return `<div style="background:var(--c);border:1px solid var(--b);border-radius:10px;padding:10px 12px;margin-bottom:8px;overflow:hidden;${borderL}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:600;color:var(--t);overflow-wrap:anywhere;word-break:break-word;flex:1;min-width:100px">${nom}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0">
          <span style="font-size:10px;font-family:var(--fm);background:rgba(79,168,255,.1);color:var(--a2);border:1px solid rgba(79,168,255,.2);padding:1px 7px;border-radius:20px;white-space:nowrap">${dateAff}</span>
          ${heure ? `<span style="font-size:10px;font-family:var(--fm);background:rgba(255,181,71,.08);color:var(--w);border:1px solid rgba(255,181,71,.2);padding:1px 7px;border-radius:20px;white-space:nowrap">⏰ ${heure}</span>` : ''}
          ${p.done ? `<span style="font-size:9px;background:rgba(0,212,170,.1);color:var(--a);border-radius:20px;padding:1px 6px">✅</span>` : ''}
        </div>
      </div>
      ${soin ? `<div style="font-size:11px;color:${actes ? 'var(--a)' : 'var(--m)'};margin-bottom:6px;line-height:1.4">${actes ? '💊 ' : ''}${soin}</div>` : ''}
      ${cot  ? (() => {
        // ⚡ Bloc enrichi : Date+Heure + N° Facture + ID — facilite le rapprochement
        // avec l'Historique des soins pour repérer/auditer les doublons éventuels.
        const _invNumP = p._cotation.invoice_number || null;
        const _heureP  = p._cotation._heure_reelle || p._cotation.heure || null;
        const _dateP   = p._cotation._tournee_date || (typeof _localDateStr === 'function' ? _localDateStr() : new Date().toISOString().slice(0,10));
        let _dateAffP = _dateP;
        try { _dateAffP = new Date(_dateP + 'T00:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit'}); } catch {}
        const _pidP    = p.patient_id || p.id || '—';
        const _syncIco = p._cotation._synced ? '☁️✓' : '☁️…';
        return `<div style="background:rgba(0,212,170,.05);border:1px solid rgba(0,212,170,.15);border-radius:6px;padding:6px 8px;margin-bottom:6px">
          <div style="font-size:11px;color:var(--a);font-family:var(--fm);font-weight:600;margin-bottom:3px">
            ✅ Cotation : ${parseFloat(p._cotation.total||0).toFixed(2)} € ${_syncIco}
          </div>
          <div style="font-size:9px;color:var(--m);font-family:var(--fm);line-height:1.5">
            ${_dateAffP}${_heureP ? ' · ' + _heureP : ''}<br>
            ${_invNumP ? `N° <span style="color:var(--a)">${_invNumP}</span>` : '<span style="color:#f59e0b">N° en attente</span>'}
            <span style="opacity:.6"> · ID #${String(_pidP).slice(-6)}</span>
          </div>
        </div>`;
      })() : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">

        <button onclick="_planningRemovePatient(${idx})" style="font-size:10px;font-family:var(--fm);padding:3px 9px;border-radius:20px;border:1px solid var(--b);background:none;color:var(--m);cursor:pointer">✕</button>
      </div>
    </div>`;
  }

  // ── Rendu vue CABINET (colonnes par IDE + CA estimé + sélecteur IDE) ────────
  function renderCabinetView() {
    const ideList = Object.entries(cabinetAssignments);

    // ⚡ Pas de membres → cabinet en cours de chargement (initCabinet async)
    if (!ideList.length) {
      setTimeout(() => {
        const cabNow = APP.get ? APP.get('cabinet') : null;
        if (cabNow?.members?.length) renderPlanning({}).catch(() => {});
      }, 900);
      return `<div style="text-align:center;padding:32px 16px">
        <div class="spin spinw" style="width:24px;height:24px;margin:0 auto 10px"></div>
        <div style="font-size:13px;color:var(--m)">Chargement des membres du cabinet…</div>
        <div style="font-size:11px;color:var(--m);margin-top:6px">Si le problème persiste, cliquez sur ↻ Actualiser</div>
      </div>`;
    }

    // ── CA validé + CA estimé par IDE ─────────────────────────────────────
    // Par IDE : compte le CA complet de chaque patient qui lui est assigné (un IDE "voit" tout le CA de ses patients)
    // Total global : dédupliqué par patient pour éviter de compter 2 fois un patient assigné à 2 IDEs
    const caValByIde = {}, caEstByIde = {};
    ideList.forEach(([ideId, a]) => {
      caValByIde[ideId] = a.patients.reduce((s, p) =>
        s + (p._cotation?.validated ? parseFloat(p._cotation.total||0) : 0), 0);
      caEstByIde[ideId] = typeof estimateRevenue === 'function'
        ? estimateRevenue(a.patients) : a.patients.length * 6.30;
    });
    // Total dédupliqué : chaque patient compté une seule fois (clé patient_id ou _planIdx)
    const _seenPat = new Set();
    let caValTotal = 0, caEstTotal = 0;
    ideList.forEach(([_, a]) => {
      (a.patients || []).forEach(p => {
        const key = p.patient_id || p.id || `_idx_${p._planIdx}`;
        if (_seenPat.has(key)) return;
        _seenPat.add(key);
        if (p._cotation?.validated) caValTotal += parseFloat(p._cotation.total||0);
        caEstTotal += (typeof estimateRevenue === 'function' ? estimateRevenue([p]) : 6.30);
      });
    });

    // ── Sélecteur multi-IDE (cases à cocher) — un patient peut être assigné à plusieurs IDEs ─
    // Affiché dans chaque carte patient de la vue cabinet : permet de cocher/décocher
    // les IDEs qui réalisent l'acte. Le patient apparaît dans toutes les colonnes cochées.
    function ideSelectHtml(p, currentIdeId) {
      const safeIdx = p._planIdx ?? -1;
      // Récupère la liste des IDEs assignés (rétrocompat _assignedIde unique)
      const assigned = Array.isArray(p._assignedIdes)
        ? p._assignedIdes.slice()
        : (p._assignedIde ? [p._assignedIde] : []);
      // Si vide → le patient est dans l'IDE courant (clustering auto)
      if (!assigned.length && currentIdeId) assigned.push(currentIdeId);

      return `<details style="margin-top:4px;font-family:var(--fm)">
        <summary style="font-size:10px;padding:2px 7px;border-radius:6px;border:1px solid var(--b);
          background:var(--s);color:var(--t);cursor:pointer;user-select:none;display:inline-flex;
          align-items:center;gap:4px;list-style:none;max-width:140px">
          <span style="color:var(--a)">👥</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
            ${assigned.length} IDE${assigned.length > 1 ? 's' : ''}
          </span>
          <span style="color:var(--m)">▾</span>
        </summary>
        <div style="position:absolute;z-index:100;background:var(--c);border:1px solid var(--b);
          border-radius:8px;padding:6px;margin-top:2px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,.3)">
          ${ideList.map(([id, a]) => {
            const chk   = assigned.includes(id);
            const label = `${a.prenom} ${a.nom}`.trim() || id;
            const safeId = id.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
            return `<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;
              border-radius:5px;cursor:pointer;font-size:11px;color:var(--t);
              background:${chk?'rgba(0,212,170,.08)':'transparent'};
              transition:background .1s">
              <input type="checkbox" ${chk?'checked':''}
                onchange="window._planningToggleIDE('${safeId}', ${safeIdx}, this.checked)"
                onclick="event.stopPropagation()"
                style="accent-color:var(--a);width:12px;height:12px;flex-shrink:0">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
            </label>`;
          }).join('')}
        </div>
      </details>`;
    }

    // ── Carte patient compacte pour la grille cabinet ─────────────────────
    function patCardCab(p, ideId, color) {
      const nom   = p._nomAff || [p.prenom, p.nom].filter(Boolean).join(' ') || 'Patient';
      const soin  = ((typeof _enrichSoinLabel === 'function')
        ? _enrichSoinLabel({
            actes_recurrents: p.actes_recurrents || '',
            pathologies:      p.pathologies || '',
            description:      p.description || p.texte || '',
          }, 55)
        : (p.actes_recurrents || p.description || p.texte || '')
      ).slice(0, 55);
      const heure = p.heure_soin || p.heure_preferee || p.heure || '';
      const cot   = p._cotation?.validated;
      const caEst = typeof estimateRevenue === 'function' ? estimateRevenue([p]) : 6.30;
      return `<div style="background:var(--c);border:1px solid var(--b);border-left:3px solid ${color};
                          border-radius:8px;padding:8px 10px;margin-bottom:6px">
        <div style="font-size:12px;font-weight:600;color:var(--t);margin-bottom:2px">${nom}</div>
        ${heure ? `<div style="font-size:10px;color:var(--w);font-family:var(--fm)">⏰ ${heure}</div>` : ''}
        ${soin  ? `<div style="font-size:10px;color:var(--m);margin:2px 0;line-height:1.3">${soin}</div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-top:4px">
          <span style="font-size:10px;font-family:var(--fm);font-weight:600;color:${cot ? 'var(--a)' : color}">
            💶 ${cot ? parseFloat(p._cotation.total).toFixed(2) : '~' + caEst.toFixed(2)} €
          </span>
          ${ideSelectHtml(p, ideId)}
        </div>
      </div>`;
    }

    // ── Résoudre le jour d'un patient ─────────────────────────────────────
    function resolveJour(p) {
      if (p.date) {
        try {
          const pd = new Date(p.date);
          // ⚡ Même garde que ci-dessus : éviter epoch (jeudi 01/01/1970)
          if (!isNaN(pd) && pd.getTime() !== 0) {
            const nj = pd.toLocaleDateString('fr-FR', { weekday:'long' }).toLowerCase();
            return JOURS.find(jj => nj.startsWith(jj)) || null;
          }
        } catch {}
      }
      const desc = (p.description || p.texte || '').toLowerCase();
      const fromDesc = JOURS.find(jj => desc.includes(jj));
      if (fromDesc) return fromDesc;
      const stableKey = String(p.patient_id || p.id || p.nom || p._nomAff || '');
      if (stableKey) {
        let hash = 0;
        for (let ci = 0; ci < stableKey.length; ci++) hash = (hash * 31 + stableKey.charCodeAt(ci)) & 0x7fffffff;
        return JOURS[hash % JOURS.length];
      }
      return null;
    }

    // ── Layout : bandeau IDEs en haut (flex wrap) + liste jours en dessous ──
    // Scalable : fonctionne avec 2 comme avec 10 IDEs sans casser la mise en page

    // Bandeau IDEs — cartes horizontales avec wrap automatique
    const ideCards = ideList.map(([ideId, a]) => {
      const caV   = caValByIde[ideId] || 0;
      const caE   = caEstByIde[ideId] || 0;
      const shown = caV > 0 ? caV : caE;
      const isVal = caV > 0;
      return `<div style="flex:1;min-width:160px;max-width:280px;padding:12px 14px;
                          background:${a.color}10;border:1px solid ${a.color}30;
                          border-top:3px solid ${a.color};border-radius:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="width:28px;height:28px;border-radius:50%;background:${a.color}20;
                      display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">
            ${a.role === 'titulaire' ? '👑' : '👤'}
          </div>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--t)">${a.prenom} ${a.nom}</div>
            <div style="font-size:10px;color:var(--m);font-family:var(--fm)">${a.patients.length} patient(s)</div>
          </div>
        </div>
        <div style="font-size:14px;font-weight:700;color:${a.color};font-family:var(--fm)">
          💶 ${shown.toFixed(2)} €
          <span style="font-size:9px;font-weight:400;opacity:.7">${isVal ? 'validé' : 'estimé'}</span>
        </div>
      </div>`;
    }).join('');

    // Lignes de jours — colonne Jour + patients de TOUS les IDEs avec badge couleur IDE
    const dayRows = JOURS.map((j, ji) => {
      const dateJ  = weekDates[ji];
      const _y = dateJ.getFullYear(), _m = String(dateJ.getMonth()+1).padStart(2,'0'), _d = String(dateJ.getDate()).padStart(2,'0');
      const isToday = `${_y}-${_m}-${_d}` === todayISO;
      const dateStr = dateJ.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
      const jourCap = j.charAt(0).toUpperCase() + j.slice(1);

      // Tous les patients de ce jour, tous IDEs confondus — avec couleur IDE
      const allDayPats = [];
      ideList.forEach(([ideId, a]) => {
        a.patients.filter(p => resolveJour(p) === j).forEach(p => {
          allDayPats.push({ p, ideId, color: a.color, prenom: a.prenom });
        });
      });

      const patsHtml = allDayPats.length
        ? allDayPats.map(({ p, ideId, color, prenom }) => {
            const nom   = p._nomAff || [p.prenom, p.nom].filter(Boolean).join(' ') || 'Patient';
            const soin  = ((typeof _enrichSoinLabel === 'function')
              ? _enrichSoinLabel({
                  actes_recurrents: p.actes_recurrents || '',
                  pathologies:      p.pathologies || '',
                  description:      p.description || p.texte || '',
                }, 60)
              : (p.actes_recurrents || p.description || p.texte || '')
            ).slice(0, 60);
            const heure = p.heure_soin || p.heure_preferee || p.heure || '';
            const cot   = p._cotation?.validated;
            const caEst = typeof estimateRevenue === 'function' ? estimateRevenue([p]) : 6.30;
            return `<div style="background:var(--c);border:1px solid var(--b);border-left:3px solid ${color};
                                border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;align-items:flex-start;gap:8px">
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:var(--t)">${nom}</div>
                ${heure ? `<div style="font-size:10px;color:var(--w);font-family:var(--fm)">⏰ ${heure}</div>` : ''}
                ${soin  ? `<div style="font-size:10px;color:var(--m);margin-top:2px">${soin}</div>` : ''}
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
                  <span style="font-size:10px;font-family:var(--fm);font-weight:600;color:${cot ? 'var(--a)' : color}">
                    💶 ${cot ? parseFloat(p._cotation.total).toFixed(2) : '~' + caEst.toFixed(2)} €
                  </span>
                  ${ideSelectHtml(p, ideId)}
                </div>
              </div>
              <div style="flex-shrink:0;font-size:10px;font-family:var(--fm);color:${color};
                          background:${color}15;padding:2px 7px;border-radius:20px;border:1px solid ${color}30;
                          white-space:nowrap;margin-top:2px">${prenom}</div>
            </div>`;
          }).join('')
        : `<div style="font-size:11px;color:var(--b);padding:12px 0;text-align:center">—</div>`;

      return `<div style="display:grid;grid-template-columns:72px 1fr;border-bottom:1px solid var(--b)${isToday ? ';background:rgba(0,212,170,.025)' : ''}">
        <div style="padding:8px 6px;border-right:1px solid var(--b);display:flex;flex-direction:column;justify-content:center;gap:2px">
          <div style="font-size:11px;font-weight:${isToday ? '700' : '600'};color:${isToday ? 'var(--a)' : 'var(--t)'}">${jourCap}</div>
          <div style="font-size:10px;color:var(--m);font-family:var(--fm)">${dateStr}</div>
          ${isToday ? '<div style="font-size:9px;color:var(--a);font-family:var(--fm)">Auj.</div>' : ''}
          ${allDayPats.length ? `<div style="font-size:9px;font-family:var(--fm);background:rgba(0,212,170,.1);color:var(--a);padding:1px 5px;border-radius:10px;text-align:center;margin-top:2px">${allDayPats.length}</div>` : ''}
          ${allDayPats.length ? `<button onclick="_planningImportDayToTournee('${j}')" title="Importer ces ${allDayPats.length} patient(s) dans la Tournée IA + Pilotage de journée" style="margin-top:4px;font-size:9px;font-family:var(--fm);padding:3px 3px;border-radius:6px;border:1px solid var(--a);background:rgba(0,212,170,.08);color:var(--a);cursor:pointer;line-height:1.15;width:100%;font-weight:600">📥 Tournée</button>` : ''}
        </div>
        <div style="padding:8px">${patsHtml}</div>
      </div>`;
    }).join('');

    return `
      <!-- Bandeau IDEs — flex wrap, scalable -->
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        ${ideCards}
      </div>
      <!-- Grille jours — 1 colonne, patients avec badge IDE coloré -->
      <div style="border:1px solid var(--b);border-radius:10px;overflow:hidden">
        ${dayRows}
      </div>
      <!-- Barre CA cabinet -->
      <div style="margin-top:12px;padding:12px 16px;background:rgba(0,212,170,.07);border:1px solid rgba(0,212,170,.2);border-radius:10px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <div style="flex:1;min-width:140px">
          <div style="font-size:10px;color:var(--m);font-family:var(--fm);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">CA ESTIMÉ SEMAINE · CABINET</div>
          <div style="font-size:20px;font-weight:700;color:var(--a)">${(caValTotal > 0 ? caValTotal : caEstTotal).toFixed(2)} €</div>
          <div style="font-size:10px;color:var(--m);font-family:var(--fm);margin-top:2px">${caValTotal > 0 ? 'cotations validées' : 'estimation NGAP'} · ${patientsForCabinet.length} patient(s)</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${ideList.map(([ideId, a]) => {
            const shown = (caValByIde[ideId]||0) > 0 ? caValByIde[ideId] : caEstByIde[ideId]||0;
            return `<div style="padding:6px 12px;background:${a.color}12;border:1px solid ${a.color}30;border-radius:8px;text-align:center;min-width:72px">
              <div style="font-size:10px;color:var(--m);font-family:var(--fm);margin-bottom:1px">${a.prenom}</div>
              <div style="font-size:13px;font-weight:700;color:${a.color}">${shown.toFixed(2)} €</div>
              <div style="font-size:9px;color:var(--m);font-family:var(--fm)">${a.patients.length} pat.</div>
            </div>`;
          }).join('')}
        </div>
        <button onclick="planningOptimiseCabinetWeek()" class="btn bs bsm" style="font-size:11px;white-space:nowrap">⚡ Optimiser</button>
      </div>
    `;
  }

  // ── Rendu vue SOLO — disposition verticale identique à la vue cabinet ────
  // Lignes = jours (lundi → dimanche), colonne label 80px + colonne contenu
  function renderSoloView() {

    // En-tête : même structure que cabinet — "Jour" + colonne "Mes patients"
    const totalPatients = patientsToShow.length;
    const totalCotVal   = patientsToShow.filter(p => p._cotation?.validated).length;
    const header = `
      <div style="display:grid;grid-template-columns:80px 1fr;border-radius:8px 8px 0 0;overflow:hidden">
        <div style="padding:8px;background:var(--s);border:1px solid var(--b);border-radius:8px 0 0 0;display:flex;align-items:center;justify-content:center">
          <span style="font-size:11px;color:var(--m);font-family:var(--fm);text-align:center">Jour</span>
        </div>
        <div style="padding:8px 12px;background:rgba(0,212,170,.06);border-top:3px solid var(--a);border:1px solid var(--b);border-left:none;display:flex;align-items:center;gap:10px">
          <div style="font-weight:700;font-size:13px;color:var(--a)">Planning de la semaine</div>
          <div style="font-size:10px;color:var(--m);font-family:var(--fm);margin-left:auto">
            ${totalPatients} patient${totalPatients > 1 ? 's' : ''}
            ${totalCotVal > 0 ? ` · ${totalCotVal} coté${totalCotVal > 1 ? 's' : ''}` : ''}
          </div>
        </div>
      </div>`;

    // Lignes jours — même structure exacte que renderCabinetView dayRows
    const dayRows = JOURS.map((j, ji) => {
      const dateJ   = weekDates[ji];
      // ⚡ Comparaison en heure locale (pas UTC) — évite le décalage timezone
      const _djY2 = dateJ.getFullYear(), _djM2 = String(dateJ.getMonth()+1).padStart(2,'0'), _djD2 = String(dateJ.getDate()).padStart(2,'0');
      const isToday = `${_djY2}-${_djM2}-${_djD2}` === todayISO;
      const dateStr = dateJ.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
      const jourCap = j.charAt(0).toUpperCase() + j.slice(1);
      const pDay    = byDay[j].patients;

      return `<div style="display:grid;grid-template-columns:80px 1fr;border-bottom:1px solid var(--b)${isToday ? ';background:rgba(0,212,170,.025)' : ''}">
        <div style="padding:8px;border-right:1px solid var(--b);display:flex;flex-direction:column;justify-content:center;flex-shrink:0">
          <div style="font-size:12px;font-weight:${isToday ? '700' : '600'};color:${isToday ? 'var(--a)' : 'var(--t)'}">${jourCap}</div>
          <div style="font-size:10px;color:var(--m);font-family:var(--fm)">${dateStr}</div>
          ${isToday ? '<div style="font-size:9px;color:var(--a);font-family:var(--fm)">Aujourd\'hui</div>' : ''}
          ${pDay.length ? `<div style="font-size:9px;font-family:var(--fm);background:rgba(0,212,170,.1);color:var(--a);padding:1px 6px;border-radius:10px;display:inline-block;margin-top:4px;text-align:center">${pDay.length}</div>` : ''}
          ${pDay.length ? `<button onclick="_planningImportDayToTournee('${j}')" title="Importer ces ${pDay.length} patient(s) dans la Tournée IA + Pilotage de journée" style="margin-top:6px;font-size:9px;font-family:var(--fm);padding:4px 4px;border-radius:6px;border:1px solid var(--a);background:rgba(0,212,170,.08);color:var(--a);cursor:pointer;line-height:1.15;width:100%;font-weight:600">📥 Tournée</button>` : ''}
        </div>
        <div style="padding:6px 8px;min-height:44px">
          ${pDay.length
            ? pDay.map(p => renderPatientCard(p, isToday ? 'var(--a)' : null)).join('')
            : `<div style="font-size:11px;color:var(--b);padding:12px 0;text-align:center">—</div>`}
        </div>
      </div>`;
    }).join('');

    // Total cotations semaine
    const totalCot = patientsToShow.reduce((s, p) => s + (p._cotation?.validated ? (p._cotation.total||0) : 0), 0);

    return `
      ${header}
      <div style="border:1px solid var(--b);border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
        ${dayRows}
      </div>
      ${totalCot > 0 ? `
      <div style="margin-top:12px;padding:10px 14px;background:rgba(0,212,170,.08);border-radius:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span style="font-size:13px;font-weight:600">💶 Total cotations validées cette semaine</span>
        <strong style="font-size:16px;color:var(--a)">${totalCot.toFixed(2)} €</strong>
      </div>` : ''}`;
  }

  // ── Assemblage final ──────────────────────────────────────────────────────
  // cabinetBar uniquement en mode cabinet (jamais en solo)
  const cabinetBar = cabinetActive ? `
    <div style="margin-bottom:16px;padding:10px 14px;background:rgba(0,212,170,.06);border:1px solid rgba(0,212,170,.2);border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:13px">🏥 <strong>${cab?.nom || 'Mon cabinet'}</strong></span>
      <span style="font-size:12px;color:var(--m)">${Object.keys(cabinetAssignments).length} IDE(s) · Vue cabinet active</span>
      <button onclick="planningOptimiseCabinetWeek()" class="btn bs bsm" style="margin-left:auto"><span>⚡</span> Optimiser la répartition</button>
    </div>` : '';

  // ⚡ Construire le HTML en 2 étapes pour éviter qu'une erreur dans renderCabinetView()
  // fasse échouer silencieusement tout le template literal (pbody.innerHTML non mis à jour)
  let _dynamicView = '';
  if (cabinetActive) {
    try {
      _dynamicView = renderCabinetView();
    } catch(e) {
      console.error('[AMI Planning] renderCabinetView ERREUR :', e.message, e.stack);
      _dynamicView = `<div class="ai er">Erreur vue cabinet : ${e.message}<br><small>${e.stack}</small></div>`;
    }
  } else {
    try {
      _dynamicView = renderSoloView();
    } catch(e) {
      console.error('[AMI Planning] renderSoloView ERREUR :', e.message);
      _dynamicView = `<div class="ai er">Erreur vue solo : ${e.message}</div>`;
    }
  }

  const _shellHTML = `
    <div class="card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div>
          <div class="ct" style="margin-bottom:4px">📅 Planning hebdomadaire${cabinetActive ? ' — Vue cabinet' : ''}</div>
          <div style="font-size:12px;color:var(--m);font-family:var(--fm)">${patientsToShow.length} patient(s) · ${nbCot} cotation(s) validée(s)${_planningWeekOffset !== 0 ? ` · ${_planningWeekOffset > 0 ? '+' : ''}${_planningWeekOffset} sem.` : ''}</div>
        </div>
        <button onclick="_planningResetAll()" style="font-family:var(--fm);font-size:11px;padding:6px 14px;border-radius:20px;border:1px solid rgba(255,95,109,.35);background:rgba(255,95,109,.06);color:var(--d);cursor:pointer;white-space:nowrap">
          🗑️ Effacer tout le planning
        </button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        ${caWeek ? `<div style="background:rgba(0,212,170,.08);border:1px solid rgba(0,212,170,.2);border-radius:10px;padding:8px 14px;font-size:12px"><div style="color:var(--m);font-family:var(--fm);font-size:10px;margin-bottom:2px">CA ESTIMÉ SEMAINE</div><div style="color:var(--a);font-weight:700">${caWeek.toFixed(2)} €</div></div>` : ''}
        ${nbCot > 0 ? `<div style="background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:8px 14px;font-size:12px"><div style="color:var(--m);font-family:var(--fm);font-size:10px;margin-bottom:2px">COTATIONS VALIDÉES</div><div style="color:#22c55e;font-weight:700">${totalCot.toFixed(2)} €</div></div>` : ''}
        ${cabinetActive ? `<div style="background:rgba(0,212,170,.06);border:1px solid rgba(0,212,170,.2);border-radius:10px;padding:8px 14px;font-size:12px"><div style="color:var(--m);font-family:var(--fm);font-size:10px;margin-bottom:2px">CABINET</div><div style="color:var(--a);font-weight:700">${Object.keys(cabinetAssignments).length} IDE(s)</div></div>` : ''}
      </div>
      ${cabinetBar}
      <div id="planning-dynamic-view"></div>
    </div>`;

  $('pbody').innerHTML = _shellHTML;

  // Injecter la vue dynamique dans son conteneur dédié (évite le crash silencieux)
  const _dynEl = document.getElementById('planning-dynamic-view');
  if (_dynEl) _dynEl.innerHTML = _dynamicView;

  const resPla = document.getElementById('res-pla');
  if (resPla) resPla.classList.add('show');
}


/* Optimiser la répartition cabinet pour la semaine affichée */
async function planningOptimiseCabinetWeek() {
  const cab = APP.get ? APP.get('cabinet') : null;
  if (!cab?.id || !cab.members?.length) return;

  const patients = window.APP._planningData?.patients
    || APP.importedData?.patients
    || APP.importedData?.entries || [];
  if (!patients.length) { if (typeof showToast === 'function') showToast('Aucun patient à optimiser.', 'wa'); return; }

  if (typeof showToast === 'function') showToast('⚡ Optimisation en cours…', 'ok');

  try {
    // Reclustering intelligent si disponible
    if (typeof smartCluster === 'function' && typeof cabinetGeoCluster === 'function') {
      const clusters = smartCluster(patients, cab.members.length);
      cab.members.forEach((m, i) => {
        (clusters[i] || []).forEach(p => { p.performed_by = m.id || m.infirmiere_id; });
      });
    }
    renderPlanning({}).catch(() => {});
    if (typeof showToast === 'function') showToast('✅ Répartition optimisée !', 'ok');
  } catch(e) {
    if (typeof showToast === 'function') showToast('❌ ' + e.message, 'err');
  }
}
function _planningDeleteCotation(idx) {
  const patients = APP.importedData?.patients || APP.importedData?.entries || [];
  const p = patients[idx];
  if (!p) return;
  if (!confirm(`Supprimer la cotation de ${[p.prenom, p.nom].filter(Boolean).join(' ') || 'ce patient'} ?`)) return;
  delete p._cotation;
  // Ré-afficher le planning
  renderPlanning({}).catch(()=>{});
  if (typeof showToast === 'function') showToast('🗑️ Cotation supprimée.');
}

/* Retirer un patient du planning */
function _planningRemovePatient(idx) {
  // Source unique de vérité : APP._planningData (utilisée par renderPlanning)
  const planData = window.APP._planningData;
  const arr = planData?.patients
    || APP.importedData?.patients
    || APP.importedData?.entries
    || [];
  if (!arr.length) return;

  const p = arr[idx];
  if (!p) return;
  const nom = [p?.prenom, p?.nom].filter(Boolean).join(' ')
    || p?.description?.split(' ').slice(0,3).join(' ')
    || 'ce patient';
  if (!confirm(`Retirer ${nom} du planning ?`)) return;

  const newArr = arr.filter((_, i) => i !== idx);

  // Mettre à jour APP._planningData (source que renderPlanning utilise)
  if (planData) {
    planData.patients = newArr;
    planData.total    = newArr.length;
  }
  // Mettre à jour APP.importedData en miroir si présent
  if (APP.importedData) {
    const key = APP.importedData.patients ? 'patients' : 'entries';
    APP.importedData[key] = newArr;
    APP.importedData.total = newArr.length;
  }

  // Persister localement + serveur
  if (newArr.length) {
    _savePlanning(newArr);
    _syncPlanningToServer(newArr).catch(() => {});
  } else {
    // Plus aucun patient : vider complètement
    _clearPlanning();
    _syncPlanningToServer([]).catch(() => {});
  }

  renderPlanning({}).catch(() => {});
  if (typeof showToast === 'function') showToast('✅ Patient retiré du planning.');
}

/* Réassigner un patient à un autre IDE dans la vue cabinet */
window._planningReassignIDE = function(newIdeId, patientIdx) {
  // Rétrocompat : si un ancien code appelle encore cette fonction, on REMPLACE toute la liste
  const planData = window.APP._planningData;
  const arr = planData?.patients
    || APP.importedData?.patients
    || APP.importedData?.entries
    || [];
  if (patientIdx < 0 || patientIdx >= arr.length) return;
  arr[patientIdx] = { ...arr[patientIdx], _assignedIdes: [newIdeId], _assignedIde: newIdeId };
  _savePlanning(arr);
  _syncPlanningToServer(arr).catch(() => {});
  renderPlanning({}).catch(() => {});
};

/* Toggle un IDE pour un patient : coche/décoche l'IDE dans la liste _assignedIdes.
   Garantit qu'au moins un IDE reste assigné (empêche un patient orphelin). */
window._planningToggleIDE = function(ideId, patientIdx, checked) {
  const planData = window.APP._planningData;
  const arr = planData?.patients
    || APP.importedData?.patients
    || APP.importedData?.entries
    || [];
  if (patientIdx < 0 || patientIdx >= arr.length) return;

  const p = arr[patientIdx];
  // Normaliser : rétrocompat _assignedIde singleton → tableau
  let ides = Array.isArray(p._assignedIdes)
    ? p._assignedIdes.slice()
    : (p._assignedIde ? [p._assignedIde] : []);

  if (checked) {
    if (!ides.includes(ideId)) ides.push(ideId);
  } else {
    ides = ides.filter(id => id !== ideId);
    // Garde-fou : au moins un IDE doit rester assigné
    if (!ides.length) {
      if (typeof showToast === 'function') {
        showToast('⚠️ Au moins un IDE doit rester assigné', 'wa');
      }
      renderPlanning({}).catch(() => {});
      return;
    }
  }

  arr[patientIdx] = {
    ...p,
    _assignedIdes: ides,
    _assignedIde:  ides[0],   // rétrocompat : champ singleton = premier IDE de la liste
  };

  _savePlanning(arr);
  _syncPlanningToServer(arr).catch(() => {});
  renderPlanning({}).catch(() => {});
};

/* Effacer tout le planning hebdomadaire */
function _planningResetAll() {
  const arr = window.APP._planningData?.patients
    || APP.importedData?.patients
    || APP.importedData?.entries
    || [];
  const n = arr.length;
  if (!confirm(`Réinitialiser le planning ?\n\n${n} patient(s) seront supprimés.\nCette action ne supprime PAS les fiches du carnet patient.`)) return;

  // Vider les DEUX sources pour éviter toute résurrection
  window.APP._planningData = null;
  APP.importedData          = null;

  // Bloquer la re-sync serveur pour cette session
  _planningManuallyCleared = true;

  // Vider le stockage local + serveur
  _clearPlanning();
  _syncPlanningToServer([]).catch(() => {});

  $('pbody').innerHTML = '<div class="ai in" style="margin-top:12px">Planning effacé. Importez de nouvelles données depuis "Import calendrier".</div>';
  $('res-pla').classList.add('show');
  const banner = $('pla-import-banner');
  if (banner) banner.style.display = 'none';
  if (typeof showToast === 'function') showToast('🗑️ Planning effacé.');
}

/* ════════════════════════════════════════════════════════════════════════
   _planningImportDayToTournee(jourKey)
   ────────────────────────────────────────────────────────────────────────
   Importe TOUS les patients d'un jour donné (lundi, mardi, …) du Planning
   hebdomadaire vers la Tournée optimisée par IA + le Pilotage de journée.

   Mécanisme :
   1. Lit window._planningByDay (cache mis à jour par renderPlanning)
   2. Écrit APP.importedData = { patients: [...du jour], total, source }
      → loadUberPatients() (uber.js) charge ces patients dans uberPatients
        au prochain "Démarrer la journée" (Pilotage).
      → optimiserTournee() (tournee.js) les voit aussi pour la Tournée IA.
   3. NE PAS appeler storeImportedData() ni _syncPlanningStorage() :
      cela écraserait _planningData (qui doit conserver toute la semaine).
   4. Émet manuellement un toast ; ne navigue pas automatiquement
      (l'IDE choisit Tournée IA OU Pilotage).
════════════════════════════════════════════════════════════════════════ */
window._planningImportDayToTournee = function(jourKey) {
  const dayData = window._planningByDay?.[jourKey];
  const pats    = dayData?.patients || [];

  if (!pats.length) {
    if (typeof showToast === 'function') showToast('Aucun patient ce jour.', 'wa');
    return;
  }

  // Label du jour pour les messages (capitalisation)
  const labelJour = jourKey.charAt(0).toUpperCase() + jourKey.slice(1);
  const dateJour  = dayData?.date instanceof Date
    ? dayData.date.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' })
    : '';
  const ctxJour = dateJour ? `${labelJour} ${dateJour}` : labelJour;

  // Confirmation : opération non destructive mais explicite
  if (!confirm(`Importer les ${pats.length} patient(s) de ${ctxJour} dans la Tournée optimisée par IA + Pilotage de journée ?\n\n(Le Planning hebdomadaire reste inchangé.)`)) {
    return;
  }

  // ⚡ Cloner les patients pour découpler le state Planning du state Tournée :
  // une cotation faite en Pilotage ne doit pas écrire dans _planningData.
  const patsClone = pats.map(p => ({ ...p }));

  // ⚡ IMPORTANT : poser _skipPlanningSync AVANT l'assignation à APP.importedData.
  // Le setter de APP.importedData (utils.js) émet immédiatement app:update via
  // APP.set() → si le flag n'est pas déjà dans l'objet, le listener app:update
  // de planning.js écrasera _planningData avec seulement les patients du jour.
  APP.importedData = {
    patients:          patsClone,
    total:             patsClone.length,
    source:            `planning_jour_${jourKey}`,
    _fromPlanningDay:  jourKey,
    _fromPlanningDate: dateJour,
    _skipPlanningSync: true,  // ⚠️ DOIT être posé AVANT l'assignation
  };

  // Mettre à jour le bandeau "import disponible" dans la vue Tournée IA
  if (typeof showCaFromImport === 'function') {
    try { showCaFromImport(); } catch {}
  }

  // Mettre à jour les selects de contraintes de passage (vue Pilotage)
  if (typeof populateConstraintSelects === 'function') {
    try { populateConstraintSelects(); } catch {}
  }

  // Toast de confirmation avec rappel des étapes suivantes
  if (typeof showToast === 'function') {
    showToast(`✅ ${pats.length} patient(s) du ${ctxJour} prêts. Allez sur Tournée IA ou Pilotage de journée.`, 'ok', 5000);
  }
};

