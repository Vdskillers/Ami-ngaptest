/* ════════════════════════════════════════════════
   profil.js — AMI NGAP (v3.9 — signature IDE)
   ────────────────────────────────────────────────
   Modale profil utilisateur
   - openPM() / closePM()
   - savePM() — sauvegarde les infos professionnelles
   - changePwd() — changement mot de passe
   - delAccount() — suppression compte RGPD
   - ✍️ Onglet signature électronique IDE (via signature.js)
════════════════════════════════════════════════ */
/* PROFIL */
async function openPM(){
  $('pm').classList.add('open');hideM('pe','po','ppe','ppo');
  const u=S?.user||{};
  $('p-fn').value=u.prenom||'';$('p-ln').value=u.nom||'';$('p-ad').value=u.adeli||'';$('p-rp').value=u.rpps||'';$('p-st').value=u.structure||'';$('p-adr').value=u.adresse||'';$('p-tel').value=u.tel||'';
  try{const d=await wpost('/webhook/profil-get',{});if(d.ok&&d.profil){const p=d.profil;$('p-fn').value=p.prenom||'';$('p-ln').value=p.nom||'';$('p-ad').value=p.adeli||'';$('p-rp').value=p.rpps||'';$('p-st').value=p.structure||'';$('p-adr').value=p.adresse||'';$('p-tel').value=p.tel||'';}}catch{}
  // ✍️ Signature électronique IDE — rafraîchir l'UI (preview + état boutons)
  try{if(typeof refreshIDESignatureUI==='function')refreshIDESignatureUI();}catch{}
  // 💎 État abonnement — rendu dans #pm-sub-status
  try{_renderProfileSubStatus();}catch(e){console.warn('[profil sub status]',e.message);}
}

/* ══════════════════════════════════════════════════════════════════
   💎 État d'abonnement dans Mon profil
   ──────────────────────────────────────────────────────────────
   Lit SUB.getState() et affiche :
   - Le tier actuel (Essentiel/Pro/Cabinet/Premium/Comptable/Trial/Locked)
   - Le temps restant (jours avant fin essai ou fin abo payant)
   - Une barre de progression visuelle
   - Un CTA vers "Mon abonnement" pour changer de plan
   - Un bandeau "Mode test" si l'app est en mode TEST global
══════════════════════════════════════════════════════════════════ */
function _renderProfileSubStatus() {
  const wrap = $('pm-sub-status');
  if (!wrap) return;
  if (typeof SUB === 'undefined' || !SUB.getState) { wrap.style.display = 'none'; return; }

  const st = SUB.getState();
  const TIERS = SUB.TIERS || {};

  // ── Cas 1 : Admin en mode bypass ────────────────────────────────
  if (st.isAdmin && !st.simTier) {
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="pm-sub-header admin">
        <span class="pm-sub-ic">🛡️</span>
        <div class="pm-sub-info">
          <div class="pm-sub-label">Statut abonnement</div>
          <div class="pm-sub-tier" style="color:var(--w)">Mode admin — Accès illimité</div>
          <div class="pm-sub-sub">Vous contournez tous les verrous d'abonnement.</div>
        </div>
      </div>`;
    return;
  }

  // ── Cas 2 : Mode TEST global (pas de limitation) ────────────────
  if (st.appMode === 'TEST' && !st.isAdminSim) {
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="pm-sub-header test">
        <span class="pm-sub-ic">🧪</span>
        <div class="pm-sub-info">
          <div class="pm-sub-label">Statut abonnement</div>
          <div class="pm-sub-tier" style="color:var(--a)">Mode démonstration</div>
          <div class="pm-sub-sub">L'application est en accès libre pendant la phase de test. Toutes les fonctionnalités sont disponibles.</div>
        </div>
      </div>
      <div class="pm-sub-note">
        ℹ️ À la mise en production, un essai gratuit de 30 jours sera automatiquement activé.
      </div>`;
    return;
  }

  // ── Cas 3 : Simulation admin active ─────────────────────────────
  if (st.isAdminSim) {
    const tinfo = TIERS[st.simTier] || {};
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="pm-sub-header sim">
        <span class="pm-sub-ic">🎭</span>
        <div class="pm-sub-info">
          <div class="pm-sub-label">Statut abonnement (simulation)</div>
          <div class="pm-sub-tier" style="color:${tinfo.color||'var(--a)'}">${tinfo.label || st.simTier}</div>
          <div class="pm-sub-sub">Vous simulez ce tier. Bypass réel disponible à tout moment depuis "Mon abonnement".</div>
        </div>
      </div>`;
    return;
  }

  // ── Cas 4 : LOCKED (essai/abo expiré) ───────────────────────────
  if (st.locked) {
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="pm-sub-header locked">
        <span class="pm-sub-ic">🔒</span>
        <div class="pm-sub-info">
          <div class="pm-sub-label">Statut abonnement</div>
          <div class="pm-sub-tier" style="color:var(--d)">Aucun abonnement actif</div>
          <div class="pm-sub-sub">Votre essai gratuit est terminé. Choisissez un plan pour retrouver l'accès complet.</div>
        </div>
      </div>
      <button class="btn bp bsm pm-sub-cta" onclick="closePM();navTo('mon-abo')">
        💎 Voir les abonnements
      </button>`;
    return;
  }

  // ── Cas 5 : TRIAL en cours ──────────────────────────────────────
  if (st.isTrial && st.daysLeft != null) {
    const TRIAL_DAYS = 30;
    const daysLeft = Math.max(0, st.daysLeft);
    const progress = Math.max(0, Math.min(100, (daysLeft / TRIAL_DAYS) * 100));
    const urgent = daysLeft <= 7;
    const endStr = st.trialEnd ? new Date(st.trialEnd).toLocaleDateString('fr-FR', {day:'2-digit', month:'long', year:'numeric'}) : '';
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="pm-sub-header trial ${urgent?'urgent':''}">
        <span class="pm-sub-ic">✨</span>
        <div class="pm-sub-info">
          <div class="pm-sub-label">Statut abonnement</div>
          <div class="pm-sub-tier" style="color:var(--a)">Essai gratuit</div>
          <div class="pm-sub-sub">${daysLeft} jour${daysLeft>1?'s':''} restant${daysLeft>1?'s':''}${endStr?` · expire le ${endStr}`:''}</div>
        </div>
      </div>
      <div class="pm-sub-progress">
        <div class="pm-sub-progress-bar ${urgent?'urgent':''}" style="width:${progress}%"></div>
      </div>
      ${urgent ? `
        <div class="pm-sub-warn">
          ⚠️ Votre essai se termine bientôt. Souscrivez dès maintenant pour éviter toute interruption.
        </div>` : ''}
      <button class="btn bp bsm pm-sub-cta" onclick="closePM();navTo('mon-abo')">
        💎 Voir les abonnements
      </button>`;
    return;
  }

  // ── Cas 6 : Abonnement payant actif ─────────────────────────────
  if (['ESSENTIEL','PRO','CABINET','PREMIUM','COMPTABLE'].includes(st.tier)) {
    const tinfo = TIERS[st.tier] || {};
    let daysRem = null, endStr = '', lowStock = false;
    if (st.paidUntil) {
      const endDate = new Date(st.paidUntil);
      daysRem = Math.max(0, Math.ceil((endDate - Date.now()) / (1000*60*60*24)));
      endStr = endDate.toLocaleDateString('fr-FR', {day:'2-digit', month:'long', year:'numeric'});
      lowStock = daysRem <= 7;
    }
    // Progression sur base mensuelle (31j)
    const progress = daysRem != null ? Math.max(0, Math.min(100, (daysRem / 31) * 100)) : 100;
    wrap.style.display = 'block';
    wrap.innerHTML = `
      <div class="pm-sub-header active ${lowStock?'urgent':''}">
        <span class="pm-sub-ic">💎</span>
        <div class="pm-sub-info">
          <div class="pm-sub-label">Statut abonnement</div>
          <div class="pm-sub-tier" style="color:${tinfo.color||'var(--a)'}">${tinfo.label||st.tier} — ${tinfo.price||''}</div>
          <div class="pm-sub-sub">${daysRem!=null
            ? `${daysRem} jour${daysRem>1?'s':''} restant${daysRem>1?'s':''}${endStr?` · renouvellement le ${endStr}`:''}`
            : 'Abonnement actif'}</div>
        </div>
      </div>
      ${daysRem != null ? `
      <div class="pm-sub-progress">
        <div class="pm-sub-progress-bar ${lowStock?'urgent':''}" style="width:${progress}%"></div>
      </div>` : ''}
      ${st.cabinetMember ? `
      <div class="pm-sub-bonus">
        🏥 <strong>Bonus cabinet actif</strong> (${st.cabinetSize} IDE) — les fonctionnalités cabinet sont débloquées automatiquement.
      </div>` : ''}
      ${lowStock ? `
      <div class="pm-sub-warn">
        ⚠️ Votre abonnement expire bientôt. Vérifiez votre moyen de paiement.
      </div>` : ''}
      <button class="btn bs bsm pm-sub-cta" onclick="closePM();navTo('mon-abo')">
        ⚙️ Gérer mon abonnement
      </button>`;
    return;
  }

  // ── Cas 7 : Fallback (tier inconnu) ─────────────────────────────
  wrap.style.display = 'block';
  wrap.innerHTML = `
    <div class="pm-sub-header">
      <span class="pm-sub-ic">❓</span>
      <div class="pm-sub-info">
        <div class="pm-sub-label">Statut abonnement</div>
        <div class="pm-sub-tier">Non défini</div>
        <div class="pm-sub-sub">Contactez le support si le problème persiste.</div>
      </div>
    </div>
    <button class="btn bp bsm pm-sub-cta" onclick="closePM();navTo('mon-abo')">
      💎 Voir les abonnements
    </button>`;
}
function closePM(){$('pm').classList.remove('open');}
async function savePM(){
  hideM('pe','po');
  try{const d=await wpost('/webhook/profil-save',{nom:gv('p-ln'),prenom:gv('p-fn'),adeli:gv('p-ad'),rpps:gv('p-rp'),structure:gv('p-st'),adresse:gv('p-adr'),tel:gv('p-tel')});if(!d.ok)throw new Error(d.error||'Erreur');S.user={...S.user,...d.profil};ss.save(S.token,S.role,S.user);$('uname').textContent=((S.user.prenom||'')+' '+(S.user.nom||'')).trim();showM('po','✅ Profil enregistré.','o');}
  catch(e){showM('pe',e.message);}
}
async function changePwd(){
  hideM('ppe','ppo');const old=gv('p-old'),nw=gv('p-new');
  if(!old||!nw){showM('ppe','Remplissez les deux champs.');return;}
  if(nw.length<8){showM('ppe','Minimum 8 caractères.');return;}
  try{const d=await wpost('/webhook/change-password',{ancien:old,nouveau:nw});if(!d.ok)throw new Error(d.error);$('p-old').value='';$('p-new').value='';showM('ppo','✅ Mot de passe changé.','o');}catch(e){showM('ppe',e.message);}
}
async function delAccount(){
  if(!confirm('⚠️ Supprimer votre compte définitivement ?'))return;
  try{const d=await wpost('/webhook/delete-account',{});if(!d.ok)throw new Error(d.error);ss.clear();closePM();showAuthOv();switchTab('l');}catch(e){showM('pe',e.message);}
}
