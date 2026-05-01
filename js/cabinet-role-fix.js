/* ════════════════════════════════════════════════════════════════════
   cabinet-role-fix.js — AMI NGAP v1.1
   ────────────────────────────────────────────────────────────────────
   v1.1 — FIX signature apiCall
     • apiCall(path, body) prend le payload DIRECTEMENT en 2e arg
       (utils.js fait JSON.stringify en interne)
     • La v1.0 envoyait {method:'POST', body:'{"infirmiere_id":"..."}'}
       en payload → le worker recevait un objet wrappé inutilisable.
   Compagnon NON-INVASIF de cabinet.js.
   À charger APRÈS cabinet.js dans index.html :
     <script src="js/cabinet-role-fix.js?v=1.0" defer></script>

   🐛 BUGS CORRIGÉS

   1. Mauvais endpoint
      cabinet.js appelle POST /webhook/cabinet-set-role (404 — n'existe pas)
      Worker expose en réalité :
        • POST /webhook/cabinet-promote-member  (membre → gestionnaire)
        • POST /webhook/cabinet-demote-member   (gestionnaire → membre)

   2. Mauvais nom de champ dans le body
      cabinet.js envoie    : { cabinet_id, member_id, role }
      Worker attend         : { infirmiere_id }

   3. Décalage frontend / backend sur le rôle
      cabinet.js utilise   : 'manager'
      Worker stocke en BDD : 'gestionnaire'
      → cabIsManager() ne détecte pas les vrais gestionnaires retournés
        par /webhook/cabinet-get → onglets dashboard/conformité cachés
        à tort, et le bouton "Manager" reste affiché alors qu'il devrait
        afficher "Retirer manager".

   ✅ CE PATCH FAIT
   • Override window.cabPromoteToManager → bons endpoints + bons champs
   • Override window.cabIsManager        → 'manager' OU 'gestionnaire' OK
   • Override _cabRoleLabel / _cabRoleIcon (via window) → afficher Manager
     pour les deux valeurs
   • Refresh côté backend après promotion réussie pour garantir un état
     cohérent (les autres devices verront le changement).
═════════════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  /* ───── 0. Init différée si cabinet.js pas encore prêt ──────────── */
  function _ready() {
    return typeof window.cabPromoteToManager === 'function'
        && typeof window.cabIsManager        === 'function';
  }
  if (!_ready()) {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 50));
    return;
  }
  init();

  /* ════════════════════════════════════════════════════════════════ */

  function init() {
    if (window.__amiCabinetRoleFixInstalled) return;
    if (!_ready()) {
      // Cabinet.js pas encore chargé → réessayer
      setTimeout(init, 200);
      return;
    }
    window.__amiCabinetRoleFixInstalled = true;

    /* ─── Helpers ─── */

    /** Vrai pour 'manager' OU 'gestionnaire' (backend) */
    function _isManagerRole(r) {
      return r === 'manager' || r === 'gestionnaire';
    }

    /* ─── 1. cabIsManager → accepte 'gestionnaire' ─── */

    window.cabIsManager = function () {
      const r = window.cabGetMyRole();
      return r === 'titulaire' || _isManagerRole(r);
    };

    /* ─── 2. cabGetMyRole → normaliser 'gestionnaire' → 'manager' ─── */
    /*    Pour que tout le reste du code frontend qui compare === 'manager'
          continue à fonctionner (boutons, libellés, etc.) */
    const _origGetMyRole = window.cabGetMyRole;
    window.cabGetMyRole = function () {
      const r = _origGetMyRole.apply(this, arguments);
      return r === 'gestionnaire' ? 'manager' : r;
    };

    /* ─── 3. Override des helpers d'affichage ─── */

    window._cabRoleLabel = function (role) {
      if (role === 'titulaire')      return '👑 Titulaire';
      if (_isManagerRole(role))      return '⭐ Manager';
      return '👤 Membre';
    };
    window._cabRoleIcon = function (role) {
      if (role === 'titulaire')      return '👑';
      if (_isManagerRole(role))      return '⭐';
      return '👤';
    };

    /* ─── 4. Patch principal : cabPromoteToManager ─── */

    window.cabPromoteToManager = async function (memberId) {
      const myRole = window.cabGetMyRole();
      const isAdmin = (typeof S !== 'undefined' && S?.role === 'admin');
      if (myRole !== 'titulaire' && !isAdmin) {
        if (typeof showToast === 'function') showToast('❌ Réservé au titulaire du cabinet', 'e');
        return false;
      }

      const cab = (typeof APP !== 'undefined') ? APP.cabinet : null;
      if (!cab || !Array.isArray(cab.members)) return false;

      const m = cab.members.find(x => String(x.id) === String(memberId));
      if (!m) return false;

      if (m.role === 'titulaire') {
        if (typeof showToast === 'function') showToast('⚠️ Le titulaire est déjà manager par défaut', 'w');
        return false;
      }

      // Décide l'action selon le rôle actuel
      const wantsPromote = !_isManagerRole(m.role);
      const endpoint = wantsPromote
        ? '/webhook/cabinet-promote-member'
        : '/webhook/cabinet-demote-member';

      // Mise à jour optimiste locale
      const previousRole = m.role;
      m.role = wantsPromote ? 'manager' : 'membre';
      if (typeof window.renderCabinetSection === 'function') window.renderCabinetSection();

      // Appel backend (signature apiCall(path, payload) — utils.js fait
      // JSON.stringify lui-même, pas besoin de wrapper {method, body})
      let backendOk = false;
      let backendErr = null;
      try {
        if (typeof apiCall !== 'function') throw new Error('apiCall indisponible');
        const r = await apiCall(endpoint, { infirmiere_id: memberId });
        // apiCall renvoie soit {ok:true,...} soit jette
        backendOk = !!(r && (r.ok !== false));
        if (!backendOk && r && r.error) backendErr = r.error;
      } catch (e) {
        backendErr = (e && e.message) || String(e);
      }

      if (backendOk) {
        if (typeof showToast === 'function') {
          showToast(wantsPromote
            ? `✅ ${m.prenom || ''} ${m.nom || ''} est maintenant manager`
            : `↩️ ${m.prenom || ''} ${m.nom || ''} repassé en membre`, 's');
        }
        // Refresh canonique depuis le backend pour aligner les autres champs
        // (joined_at, etc.) et garantir la cohérence multi-device
        try {
          if (typeof apiCall === 'function') {
            const fresh = await apiCall('/webhook/cabinet-get', {});
            if (fresh && fresh.cabinet) {
              APP.cabinet = {
                ...fresh.cabinet,
                my_role: fresh.my_role,
                members: Array.isArray(fresh.members) ? fresh.members : []
              };
              // Re-normaliser le rôle local depuis la nouvelle source
              if (typeof window.renderCabinetSection === 'function') window.renderCabinetSection();
              if (typeof window.cabApplyRoleVisibility === 'function') window.cabApplyRoleVisibility();
            }
          }
        } catch (_) { /* refresh best-effort */ }
        return true;
      } else {
        // Rollback local
        m.role = previousRole;
        if (typeof window.renderCabinetSection === 'function') window.renderCabinetSection();
        if (typeof showToast === 'function') {
          showToast('❌ Échec : ' + (backendErr || 'erreur backend'), 'e');
        }
        console.warn('[cabinet-role-fix] échec promotion:', backendErr);
        return false;
      }
    };

    console.info('[cabinet-role-fix] installed — cabPromoteToManager corrigé (endpoints + champs + role gestionnaire)');
  }
})();
