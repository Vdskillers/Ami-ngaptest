/* ════════════════════════════════════════════════════════════════════
   profil-subscription-ui.js — AMI NGAP (v1.0)
   ────────────────────────────────────────────────────────────────────
   💎 Hook non-invasif sur openPM() pour injecter la mini-carte abonnement
      dans la modale profil. Ne modifie PAS profil.js — tout est additif.

   Stratégie :
     - Wrap window.openPM existante (préservation totale du comportement)
     - Après l'appel original, injecte un container #pm-sub-section
       AVANT le séparateur "Changer le mot de passe"
     - Délègue à SUB.renderProfileCard(containerId) le rendu complet
       (la logique vit dans subscription.js, pas ici)

   Placement (ordre de priorité) :
     1. Avant le sep "Changer le mot de passe" (ligne ~372 index.html)
     2. Avant le champ #p-old (fallback)
     3. À la fin de #pm (fallback ultime)

   Chargement : APRÈS profil.js et APRÈS subscription.js
       <script src="js/profil-subscription-ui.js?v=1.0"></script>
════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Helper : trouve ou crée le container abonnement dans la modale ── */
  function _ensureSubSectionInPM() {
    let container = document.getElementById('pm-sub-section');
    if (container) return container;

    const pm = document.getElementById('pm');
    if (!pm) return null;

    container = document.createElement('div');
    container.id = 'pm-sub-section';
    container.style.cssText = 'margin:14px 0 18px;padding:0';

    let inserted = false;

    /* ── Stratégie 1 : avant le sep "Changer le mot de passe" ── */
    // Cherche le séparateur (texte exact dans index.html ligne 372)
    const separators = pm.querySelectorAll('.sep');
    for (const sep of separators) {
      const label = sep.querySelector('.sepl');
      if (label && /mot de passe/i.test(label.textContent || '')) {
        sep.parentElement.insertBefore(container, sep);
        inserted = true;
        break;
      }
    }

    /* ── Stratégie 2 : avant le champ #p-old (fallback) ── */
    if (!inserted) {
      const pOld = document.getElementById('p-old');
      if (pOld) {
        const target = pOld.closest('.af') || pOld.parentElement;
        if (target && target.parentElement) {
          // Remonter jusqu'au sep précédent si présent
          let anchor = target;
          let prev = target.previousElementSibling;
          while (prev && !prev.classList.contains('sep')) {
            anchor = prev;
            prev = prev.previousElementSibling;
          }
          if (prev && prev.classList.contains('sep')) anchor = prev;
          target.parentElement.insertBefore(container, anchor);
          inserted = true;
        }
      }
    }

    /* ── Stratégie 3 : avant la signature (autre ancre stable) ── */
    if (!inserted) {
      const sigPreview = document.getElementById('ide-sig-preview');
      if (sigPreview) {
        const sigBlock = sigPreview.closest('div[style*="display:flex"]') || sigPreview.parentElement;
        if (sigBlock && sigBlock.parentElement) {
          // Remonter au sep précédent éventuel
          let anchor = sigBlock;
          let prev = sigBlock.previousElementSibling;
          while (prev && !prev.classList.contains('sep')) {
            anchor = prev;
            prev = prev.previousElementSibling;
          }
          if (prev && prev.classList.contains('sep')) anchor = prev;
          sigBlock.parentElement.insertBefore(container, anchor);
          inserted = true;
        }
      }
    }

    /* ── Fallback ultime : début de #pm ── */
    if (!inserted) {
      pm.insertBefore(container, pm.firstChild);
    }

    return container;
  }

  /* ── Helper : rendu de la carte abonnement (avec garde) ── */
  function _renderSubCardSafely() {
    try {
      const c = _ensureSubSectionInPM();
      if (!c) return;
      if (typeof window.SUB !== 'undefined' && typeof SUB.renderProfileCard === 'function') {
        SUB.renderProfileCard('pm-sub-section');
      } else {
        // Fallback dégradé : message minimal
        c.innerHTML = '<div style="padding:14px;background:var(--s);border:1px solid var(--b);border-radius:var(--r);color:var(--m);font-size:13px;text-align:center">💎 Information abonnement temporairement indisponible</div>';
      }
    } catch (e) {
      console.warn('[AMI] profil-sub injection KO:', e && e.message);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     Wrap openPM — préserve 100% du comportement existant
  ════════════════════════════════════════════════════════════════ */
  function _installOpenPMHook() {
    if (typeof window.openPM !== 'function') {
      // openPM pas encore défini ? Attend profil.js avec un retry court
      setTimeout(_installOpenPMHook, 100);
      return;
    }
    if (window.openPM.__subHooked) return; // idempotent

    const _originalOpenPM = window.openPM;

    window.openPM = async function _openPMWithSub() {
      // 1. Appel original (DOIT s'exécuter en premier — il remplit les champs)
      const result = await _originalOpenPM.apply(this, arguments);

      // 2. Injection de la carte abonnement
      _renderSubCardSafely();

      // 3. Refresh asynchrone des données SUB (au cas où on n'a pas encore bootstrapé)
      try {
        if (typeof window.SUB !== 'undefined' && typeof SUB.refresh === 'function') {
          SUB.refresh().then(() => _renderSubCardSafely()).catch(() => {});
        }
      } catch {}

      return result;
    };

    window.openPM.__subHooked = true;
  }

  /* ════════════════════════════════════════════════════════════════
     Wrap closePM — nettoyage propre du container (évite stale state)
  ════════════════════════════════════════════════════════════════ */
  function _installClosePMHook() {
    if (typeof window.closePM !== 'function') {
      setTimeout(_installClosePMHook, 100);
      return;
    }
    if (window.closePM.__subHooked) return;

    const _originalClosePM = window.closePM;

    window.closePM = function _closePMWithSub() {
      const result = _originalClosePM.apply(this, arguments);
      // On ne supprime PAS le container — il sera ré-écrit au prochain openPM
      // (évite les flickers et préserve les anims CSS)
      return result;
    };

    window.closePM.__subHooked = true;
  }

  /* ════════════════════════════════════════════════════════════════
     Listener : refresh la carte si SUB diffuse un changement d'état
     pendant que la modale profil est ouverte
  ════════════════════════════════════════════════════════════════ */
  function _installSubChangeListener() {
    document.addEventListener('sub:state-changed', () => {
      const pm = document.getElementById('pm');
      if (pm && pm.classList.contains('open')) {
        _renderSubCardSafely();
      }
    });
  }

  /* ── Bootstrap quand le DOM est prêt ── */
  function _boot() {
    _installOpenPMHook();
    _installClosePMHook();
    _installSubChangeListener();
    if (window.console && console.info) {
      console.info('[AMI] profil-subscription-ui v1.0 ready');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }
})();
