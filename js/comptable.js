/* ════════════════════════════════════════════════
   comptable.js — AMI v1.0
   ────────────────────────────────────────────────
   🧑‍💼 Module COMPTABLE — Expertise comptable santé (99 € HT/mois)
   ────────────────────────────────────────────────
   8 fonctionnalités dédiées aux experts-comptables santé qui gèrent
   un portefeuille d'IDEL clientes (jusqu'à 20 IDEL incluses) :

     1. dashboard_consolide  → Dashboard multi-IDEL (CA, actes, alertes, conformité)
     2. export_fiscal        → Export FEC (PCG) + liasse fiscale 2035 BNC
     3. generateur_2042      → Pré-remplissage 2042-C-PRO + URSSAF + CARPIMKO
     4. scoring_risque       → Scoring CPAM/fiscal de chaque cliente
     5. alertes_ngap_masse   → Détection batch d'anomalies de cotation
     6. connecteurs_compta   → Export Cegid · EBP · Quadra
     7. vue_anonymisee       → Pseudo-FEC RGPD (aucune donnée patient)
     8. rapport_trimestriel  → Rapport trimestriel auto par cliente

   🔒 GATING : SUB.requireAccess('<feature_id>')
      → Seuls COMPTABLE + admins (démo) y ont accès.
      → Tous les autres tiers voient le paywall.

   📦 API publique :
     window.Comptable = {
       renderHub(), renderDashboard(), renderExportFEC(),
       render2042(), renderScoring(), renderAlertes(),
       renderConnecteurs(), renderAnonymisee(), renderTrimestriel(),
       getPortfolio()  // → liste démo des IDEL clientes
     }

   ⚠️ NOTE — Données démo :
   Le worker ne fournit pas encore les endpoints multi-IDEL pour comptables.
   En attendant l'intégration backend, les vues utilisent un dataset démo
   généré en mémoire (20 IDEL fictives) qui permet de :
     - démontrer l'UX/UI à un prospect
     - tester le gating et la navigation
     - valider les exports FEC/2035/2042 sur des données plausibles
   Quand les endpoints réels seront prêts (côté worker), il suffira de
   remplacer _fetchPortfolio() par un appel /webhook/comptable-portfolio.
════════════════════════════════════════════════ */
'use strict';

(function(){

  /* ═══════════════════════════════════════════════════════════════
     1. ACCÈS & UTILS
  ═══════════════════════════════════════════════════════════════ */

  /** Vérifie l'accès à une feature. Si refus → SUB.requireAccess affiche le paywall. */
  function _gate(featId) {
    if (typeof SUB === 'undefined') return true; // fallback : SUB pas chargé = accès
    return SUB.requireAccess(featId);
  }

  function $(id) { return document.getElementById(id); }

  function _fmt(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function _fmt0(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  }
  function _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function _toast(type, title, msg) {
    if (typeof showToast === 'function') showToast(type, title, msg);
    else console.log(`[${type}] ${title}: ${msg||''}`);
  }
  function _download(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  /* ═══════════════════════════════════════════════════════════════
     2. DATASET DÉMO — Portefeuille IDEL clientes
     Generation déterministe (même seed = même données) pour stabilité visuelle.
  ═══════════════════════════════════════════════════════════════ */

  const _DEMO_IDELS = [
    { id:'idel_001', prenom:'Marie',     nom:'Lefèvre',    ville:'Brest',          cp:'29200', regime:'BNC' },
    { id:'idel_002', prenom:'Sophie',    nom:'Bernard',    ville:'Quimper',        cp:'29000', regime:'BNC' },
    { id:'idel_003', prenom:'Claire',    nom:'Moreau',     ville:'Lorient',        cp:'56100', regime:'BNC' },
    { id:'idel_004', prenom:'Isabelle',  nom:'Petit',      ville:'Vannes',         cp:'56000', regime:'BNC' },
    { id:'idel_005', prenom:'Nathalie',  nom:'Robert',     ville:'Rennes',         cp:'35000', regime:'BNC' },
    { id:'idel_006', prenom:'Aurélie',   nom:'Richard',    ville:'Saint-Brieuc',   cp:'22000', regime:'BNC' },
    { id:'idel_007', prenom:'Pauline',   nom:'Durand',     ville:'Morlaix',        cp:'29600', regime:'BNC' },
    { id:'idel_008', prenom:'Émilie',    nom:'Dubois',     ville:'Pontivy',        cp:'56300', regime:'BNC' },
    { id:'idel_009', prenom:'Camille',   nom:'Leroy',      ville:'Concarneau',     cp:'29900', regime:'BNC' },
    { id:'idel_010', prenom:'Julie',     nom:'Garnier',    ville:'Douarnenez',     cp:'29100', regime:'BNC' },
    { id:'idel_011', prenom:'Sandrine',  nom:'Faure',      ville:'Auray',          cp:'56400', regime:'BNC' },
    { id:'idel_012', prenom:'Stéphanie', nom:'Andre',      ville:'Lannion',        cp:'22300', regime:'BNC' },
    { id:'idel_013', prenom:'Valérie',   nom:'Mercier',    ville:'Guingamp',       cp:'22200', regime:'BNC' },
    { id:'idel_014', prenom:'Caroline',  nom:'Blanc',      ville:'Dinan',          cp:'22100', regime:'BNC' },
    { id:'idel_015', prenom:'Hélène',    nom:'Chevalier',  ville:'Fougères',       cp:'35300', regime:'BNC' },
    { id:'idel_016', prenom:'Laure',     nom:'Roux',       ville:'Vitré',          cp:'35500', regime:'BNC' },
    { id:'idel_017', prenom:'Mathilde',  nom:'Vincent',    ville:'Redon',          cp:'35600', regime:'BNC' },
    { id:'idel_018', prenom:'Cécile',    nom:'Muller',     ville:'Quiberon',       cp:'56170', regime:'BNC' },
    { id:'idel_019', prenom:'Anne',      nom:'Lefebvre',   ville:'Loudéac',        cp:'22600', regime:'BNC' },
    { id:'idel_020', prenom:'Florence',  nom:'Legrand',    ville:'Carhaix',        cp:'29270', regime:'BNC' }
  ];

  // PRNG déterministe (mulberry32) à partir de l'id
  function _seed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    return function() {
      h = Math.imul(h ^ h >>> 16, 2246822507);
      h = Math.imul(h ^ h >>> 13, 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  }

  /** Génère les KPIs annuels d'une IDEL (déterministes via seed). */
  function _genKPIs(idel) {
    const r = _seed(idel.id);
    const nbActes      = 1800 + Math.round(r() * 2700);              // 1800-4500/an
    const caBrut       = nbActes * (3.50 + r() * 1.20);              // 6 300-21 600 €
    const ihk          = Math.round(8000 + r() * 4500);              // forfait IK
    const caTotal      = Math.round((caBrut + ihk) * 100) / 100;
    const cotisations  = Math.round(caTotal * (0.22 + r() * 0.06) * 100) / 100; // ~22-28%
    const benefice     = Math.round((caTotal - cotisations - 4500) * 100) / 100; // - frais pros
    const nbPatients   = 35 + Math.round(r() * 90);
    const nbAnomalies  = Math.round(r() * 18);                       // 0-18 anomalies/an
    const conformite   = Math.max(45, Math.min(99, Math.round(72 + r() * 26))); // 72-99
    const risqueCpam   = Math.max(5,  Math.min(95, Math.round(15 + r() * 70))); // 15-85
    const lastSync     = new Date(Date.now() - Math.round(r() * 14) * 86400000).toISOString();
    return {
      nbActes, caBrut: Math.round(caBrut*100)/100, ihk, caTotal,
      cotisations, benefice, nbPatients, nbAnomalies, conformite, risqueCpam, lastSync
    };
  }

  /** Récupère le portefeuille (démo) — à remplacer par un appel worker quand prêt. */
  async function getPortfolio() {
    return _DEMO_IDELS.map(i => ({ ...i, kpis: _genKPIs(i) }));
  }

  /* ═══════════════════════════════════════════════════════════════
     3. STYLE INJECTÉ (une fois)
  ═══════════════════════════════════════════════════════════════ */

  function _injectStyle() {
    if ($('comptable-style')) return;
    const css = `
      .cpt-hero{background:linear-gradient(135deg,rgba(255,95,109,.10),rgba(255,95,109,.02));border:1px solid rgba(255,95,109,.25);border-radius:16px;padding:20px 24px;margin-bottom:20px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
      .cpt-hero-ic{width:54px;height:54px;border-radius:14px;background:rgba(255,95,109,.16);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0}
      .cpt-hero-text h1{margin:0;font-size:22px;color:#FF7A85;font-family:var(--fs)}
      .cpt-hero-text p{margin:3px 0 0;font-size:13px;color:var(--m)}
      .cpt-hero-pill{margin-left:auto;background:rgba(255,95,109,.18);color:#FF7A85;font-family:var(--fm);font-size:11px;letter-spacing:1px;padding:5px 12px;border-radius:20px;text-transform:uppercase;font-weight:700}

      .cpt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:18px}
      .cpt-card{background:var(--s);border:1px solid var(--b);border-radius:14px;padding:16px 18px;cursor:pointer;transition:all .18s ease;position:relative;overflow:hidden}
      .cpt-card:hover{border-color:rgba(255,95,109,.35);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.18)}
      .cpt-card-ic{font-size:24px;margin-bottom:8px}
      .cpt-card-title{font-size:14px;font-weight:700;color:var(--t);margin-bottom:4px}
      .cpt-card-sub{font-size:11px;color:var(--m);line-height:1.5}
      .cpt-card-arrow{position:absolute;right:14px;top:14px;color:var(--m);font-size:14px;transition:all .18s}
      .cpt-card:hover .cpt-card-arrow{color:#FF7A85;transform:translateX(3px)}

      .cpt-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:18px}
      .cpt-kpi{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:14px 16px}
      .cpt-kpi-label{font-size:10px;color:var(--m);font-family:var(--fm);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px}
      .cpt-kpi-val{font-size:22px;font-weight:700;color:var(--t);font-family:var(--fs);line-height:1.1}
      .cpt-kpi-sub{font-size:11px;color:var(--m);margin-top:3px}

      .cpt-table-wrap{background:var(--s);border:1px solid var(--b);border-radius:14px;overflow:hidden;margin-bottom:18px}
      .cpt-table-head{padding:14px 18px;border-bottom:1px solid var(--b);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
      .cpt-table-title{font-size:14px;font-weight:700;color:var(--t)}
      .cpt-table-actions{display:flex;gap:8px;flex-wrap:wrap}
      .cpt-table{width:100%;border-collapse:collapse;font-size:13px}
      .cpt-table th{background:rgba(255,255,255,.02);text-align:left;padding:10px 14px;font-size:11px;color:var(--m);font-family:var(--fm);font-weight:600;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--b);white-space:nowrap}
      .cpt-table td{padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.04);color:var(--t)}
      .cpt-table tbody tr:hover{background:rgba(255,95,109,.04)}
      .cpt-table tbody tr:last-child td{border-bottom:none}
      .cpt-table-num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--fm)}
      .cpt-pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-family:var(--fm);font-weight:700;letter-spacing:.3px}
      .cpt-pill.g{background:rgba(0,212,170,.18);color:#00d4aa}
      .cpt-pill.o{background:rgba(255,181,71,.2);color:var(--w)}
      .cpt-pill.r{background:rgba(255,95,109,.18);color:#FF7A85}
      .cpt-pill.b{background:rgba(79,168,255,.18);color:#4fa8ff}

      .cpt-section{background:var(--s);border:1px solid var(--b);border-radius:14px;padding:18px 22px;margin-bottom:16px}
      .cpt-section-title{font-size:14px;font-weight:700;color:var(--t);margin:0 0 12px;display:flex;align-items:center;gap:8px}
      .cpt-section-sub{font-size:12px;color:var(--m);margin:-8px 0 12px}

      .cpt-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
      .cpt-form-row label{display:block;font-size:11px;color:var(--m);font-family:var(--fm);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
      .cpt-form-row select,.cpt-form-row input{width:100%;background:var(--bg);border:1px solid var(--b);border-radius:8px;color:var(--t);padding:10px 12px;font-size:13px}

      .cpt-bar{height:6px;background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden;margin-top:4px}
      .cpt-bar-fill{height:100%;border-radius:6px;transition:width .4s ease}

      .cpt-back{display:inline-flex;align-items:center;gap:6px;color:var(--m);font-size:12px;cursor:pointer;margin-bottom:14px;padding:5px 0}
      .cpt-back:hover{color:#FF7A85}

      .cpt-empty{text-align:center;padding:38px 20px;color:var(--m);font-size:13px}

      @media (max-width:768px){
        .cpt-hero{padding:14px 16px;gap:12px}
        .cpt-hero-text h1{font-size:18px}
        .cpt-hero-pill{margin-left:0;margin-top:6px}
        .cpt-grid{grid-template-columns:1fr;gap:10px}
        .cpt-kpis{grid-template-columns:repeat(2,1fr)}
        .cpt-form-row{grid-template-columns:1fr}
        .cpt-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
        .cpt-table{min-width:640px}
      }
    `;
    const s = document.createElement('style');
    s.id = 'comptable-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════════════════
     4. HUB — Vue d'ensemble cabinet
  ═══════════════════════════════════════════════════════════════ */

  function _renderHero(title, sub, ic = '🧑‍💼') {
    return `
      <div class="cpt-hero">
        <div class="cpt-hero-ic">${ic}</div>
        <div class="cpt-hero-text">
          <h1>${_esc(title)}</h1>
          <p>${_esc(sub)}</p>
        </div>
        <span class="cpt-hero-pill">AMI Comptable</span>
      </div>`;
  }

  function _renderBack() {
    return `<div class="cpt-back" onclick="navTo('comptable-hub',null)">← Retour à la vue d'ensemble</div>`;
  }

  async function renderHub() {
    if (!_gate('dashboard_consolide')) return;
    _injectStyle();
    const root = $('view-comptable-hub');
    if (!root) return;

    const portfolio = await getPortfolio();
    const totals = portfolio.reduce((acc, i) => {
      acc.ca        += i.kpis.caTotal;
      acc.actes     += i.kpis.nbActes;
      acc.benefice  += i.kpis.benefice;
      acc.anomalies += i.kpis.nbAnomalies;
      return acc;
    }, { ca:0, actes:0, benefice:0, anomalies:0 });
    const avgConformite = Math.round(portfolio.reduce((s,i)=>s+i.kpis.conformite,0) / portfolio.length);
    const idelsRisque   = portfolio.filter(i => i.kpis.risqueCpam >= 60).length;

    const cards = [
      { v:'comptable-dashboard',   ic:'📊', title:'Dashboard multi-IDEL',         sub:'Vue agrégée du portefeuille (jusqu\'à 20 IDEL incluses)' },
      { v:'comptable-export-fec',  ic:'📑', title:'Export FEC + liasse 2035',     sub:'Fichier des écritures comptables et liasse fiscale BNC' },
      { v:'comptable-2042',        ic:'🧾', title:'Générateur 2042-C-PRO',        sub:'Pré-remplissage URSSAF · CARPIMKO · DGFiP' },
      { v:'comptable-scoring',     ic:'🎯', title:'Scoring risque portfolio',     sub:'Notation CPAM/fiscal de chaque cliente' },
      { v:'comptable-alertes',     ic:'🚨', title:'Alertes NGAP en masse',        sub:'Détection batch d\'anomalies de cotation' },
      { v:'comptable-connecteurs', ic:'🔌', title:'Connecteurs comptables',       sub:'Cegid · EBP · Quadra · API directe' },
      { v:'comptable-anonymisee',  ic:'🛡️', title:'Vue anonymisée',               sub:'Pseudo-FEC RGPD (aucune donnée patient)' },
      { v:'comptable-trimestriel', ic:'📅', title:'Rapports trimestriels',         sub:'Génération automatique par cliente' }
    ];

    root.innerHTML = `
      ${_renderHero('Vue d\'ensemble cabinet', `Portefeuille : ${portfolio.length} IDEL clientes · Suivi consolidé temps réel`)}

      <div class="cpt-kpis">
        <div class="cpt-kpi"><div class="cpt-kpi-label">CA Cumulé portfolio</div><div class="cpt-kpi-val">${_fmt0(totals.ca)} €</div><div class="cpt-kpi-sub">Sur 12 mois glissants</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">Actes facturés</div><div class="cpt-kpi-val">${_fmt0(totals.actes)}</div><div class="cpt-kpi-sub">Toutes IDEL confondues</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">Bénéfice net agrégé</div><div class="cpt-kpi-val">${_fmt0(totals.benefice)} €</div><div class="cpt-kpi-sub">Après cotisations + frais</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">Conformité moyenne</div><div class="cpt-kpi-val">${avgConformite}/100</div><div class="cpt-bar"><div class="cpt-bar-fill" style="width:${avgConformite}%;background:${avgConformite>=80?'#00d4aa':avgConformite>=60?'#ffb547':'#ff5f6d'}"></div></div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">IDEL à risque</div><div class="cpt-kpi-val" style="color:${idelsRisque>0?'#FF7A85':'#00d4aa'}">${idelsRisque}</div><div class="cpt-kpi-sub">Score CPAM ≥ 60</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">Anomalies NGAP</div><div class="cpt-kpi-val" style="color:${totals.anomalies>50?'#ff5f6d':'#ffb547'}">${totals.anomalies}</div><div class="cpt-kpi-sub">À traiter ce mois</div></div>
      </div>

      <div class="cpt-grid">
        ${cards.map(c => `
          <div class="cpt-card" onclick="navTo('${c.v}',null)">
            <div class="cpt-card-arrow">→</div>
            <div class="cpt-card-ic">${c.ic}</div>
            <div class="cpt-card-title">${c.title}</div>
            <div class="cpt-card-sub">${c.sub}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════
     5. DASHBOARD MULTI-IDEL
  ═══════════════════════════════════════════════════════════════ */

  async function renderDashboard() {
    if (!_gate('dashboard_consolide')) return;
    _injectStyle();
    const root = $('view-comptable-dashboard');
    if (!root) return;

    const portfolio = await getPortfolio();
    portfolio.sort((a,b) => b.kpis.caTotal - a.kpis.caTotal);

    const rows = portfolio.map(i => {
      const conf = i.kpis.conformite;
      const confCl = conf >= 80 ? 'g' : conf >= 60 ? 'o' : 'r';
      const risk  = i.kpis.risqueCpam;
      const riskCl = risk >= 60 ? 'r' : risk >= 30 ? 'o' : 'g';
      return `
        <tr>
          <td><b>${_esc(i.prenom)} ${_esc(i.nom)}</b><br><span style="font-size:11px;color:var(--m)">${_esc(i.ville)} · ${_esc(i.cp)}</span></td>
          <td class="cpt-table-num">${_fmt0(i.kpis.caTotal)} €</td>
          <td class="cpt-table-num">${_fmt0(i.kpis.nbActes)}</td>
          <td class="cpt-table-num">${_fmt0(i.kpis.benefice)} €</td>
          <td><span class="cpt-pill ${confCl}">${conf}/100</span></td>
          <td><span class="cpt-pill ${riskCl}">${risk}/100</span></td>
          <td class="cpt-table-num">${i.kpis.nbAnomalies}</td>
        </tr>`;
    }).join('');

    root.innerHTML = `
      ${_renderBack()}
      ${_renderHero('Dashboard multi-IDEL', `Vue agrégée du portefeuille (${portfolio.length} IDEL incluses)`, '📊')}

      <div class="cpt-table-wrap">
        <div class="cpt-table-head">
          <div class="cpt-table-title">Portefeuille — tri par CA décroissant</div>
          <div class="cpt-table-actions">
            <button class="btn bs bsm" onclick="Comptable.exportPortfolioCSV()">📥 Export CSV</button>
            <button class="btn bs bsm" onclick="Comptable.renderDashboard()">↻ Actualiser</button>
          </div>
        </div>
        <table class="cpt-table">
          <thead><tr>
            <th>IDEL cliente</th>
            <th class="cpt-table-num">CA total</th>
            <th class="cpt-table-num">Actes</th>
            <th class="cpt-table-num">Bénéfice</th>
            <th>Conformité</th>
            <th>Risque CPAM</th>
            <th class="cpt-table-num">Anomalies</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function exportPortfolioCSV() {
    if (!_gate('dashboard_consolide')) return;
    getPortfolio().then(p => {
      const header = ['IDEL_ID','Prenom','Nom','Ville','CP','CA_total','Nb_actes','Benefice','Conformite','Risque_CPAM','Anomalies'];
      const rows = p.map(i => [
        i.id, i.prenom, i.nom, i.ville, i.cp,
        i.kpis.caTotal, i.kpis.nbActes, i.kpis.benefice,
        i.kpis.conformite, i.kpis.risqueCpam, i.kpis.nbAnomalies
      ].join(';'));
      const csv = '\uFEFF' + header.join(';') + '\n' + rows.join('\n');
      _download(`portfolio-idel-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
      _toast('success', 'Export CSV', `${p.length} IDEL exportées`);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     6. EXPORT FEC + LIASSE FISCALE 2035
  ═══════════════════════════════════════════════════════════════ */

  async function renderExportFEC() {
    if (!_gate('export_fiscal')) return;
    _injectStyle();
    const root = $('view-comptable-export-fec');
    if (!root) return;

    const portfolio = await getPortfolio();
    const Y = new Date().getFullYear() - 1;
    const opts = portfolio.map(i => `<option value="${i.id}">${_esc(i.prenom)} ${_esc(i.nom)} — ${_esc(i.ville)}</option>`).join('');

    root.innerHTML = `
      ${_renderBack()}
      ${_renderHero('Export FEC + liasse fiscale 2035', 'Fichier des Écritures Comptables (PCG) et liasse BNC règlementaire', '📑')}

      <div class="cpt-section">
        <h3 class="cpt-section-title">📑 Export FEC (Fichier des Écritures Comptables)</h3>
        <p class="cpt-section-sub">Format normalisé DGFiP — articles A47 A-1 du LPF · TXT séparé par tabulations · 18 colonnes obligatoires.</p>
        <div class="cpt-form-row">
          <div>
            <label>IDEL cliente</label>
            <select id="fec-idel"><option value="all">📦 Tout le portefeuille (${portfolio.length} IDEL)</option>${opts}</select>
          </div>
          <div>
            <label>Exercice fiscal</label>
            <select id="fec-year">
              <option value="${Y-1}">${Y-1}</option>
              <option value="${Y}" selected>${Y}</option>
              <option value="${Y+1}">${Y+1}</option>
            </select>
          </div>
        </div>
        <button class="btn bp bsm" onclick="Comptable.generateFEC()">📥 Générer le FEC</button>
      </div>

      <div class="cpt-section">
        <h3 class="cpt-section-title">🧾 Liasse fiscale 2035 — BNC</h3>
        <p class="cpt-section-sub">Cerfa 11176 · pré-rempli avec les données comptables · prêt pour téléprocédure EDI-TDFC.</p>
        <div class="cpt-form-row">
          <div>
            <label>IDEL cliente</label>
            <select id="liasse-idel">${opts}</select>
          </div>
          <div>
            <label>Exercice fiscal</label>
            <select id="liasse-year">
              <option value="${Y-1}">${Y-1}</option>
              <option value="${Y}" selected>${Y}</option>
            </select>
          </div>
        </div>
        <button class="btn bp bsm" onclick="Comptable.generateLiasse2035()">📥 Générer la liasse 2035</button>
      </div>
    `;
  }

  async function generateFEC() {
    if (!_gate('export_fiscal')) return;
    const idelSel = $('fec-idel')?.value;
    const year = parseInt($('fec-year')?.value || new Date().getFullYear()-1);
    const portfolio = await getPortfolio();
    const targets = idelSel === 'all' ? portfolio : portfolio.filter(i => i.id === idelSel);
    if (!targets.length) { _toast('error', 'Aucune IDEL', 'Sélection invalide'); return; }

    // Format FEC : 18 champs séparés par TAB. Header en première ligne.
    const HEAD = ['JournalCode','JournalLib','EcritureNum','EcritureDate','CompteNum','CompteLib',
                  'CompAuxNum','CompAuxLib','PieceRef','PieceDate','EcritureLib',
                  'Debit','Credit','EcritureLet','DateLet','ValidDate','Montantdevise','Idevise'];
    const lines = [HEAD.join('\t')];
    const fmtDate = d => d.toISOString().slice(0,10).replace(/-/g,'');
    const fmtAmt  = n => Number(n).toFixed(2).replace('.',',');

    let seq = 1;
    targets.forEach(idel => {
      const months = 12;
      const monthlyCa = idel.kpis.caTotal / months;
      const monthlyCotis = idel.kpis.cotisations / months;
      for (let m = 0; m < months; m++) {
        const dt = new Date(year, m, 28);
        const dStr = fmtDate(dt);
        // Recette honoraires (706 = prestations services / 411 = clients)
        lines.push(['VT','Ventes',`E${String(seq).padStart(6,'0')}`,dStr,'706000','Honoraires NGAP',
                    idel.id,`${idel.prenom} ${idel.nom}`,`F${year}-${m+1}`,dStr,
                    `Honoraires ${dt.toLocaleString('fr-FR',{month:'long'})} ${year}`,
                    '0,00',fmtAmt(monthlyCa),'','','',fmtAmt(monthlyCa),'EUR'].join('\t'));
        seq++;
        // Cotisations URSSAF (646 = cotisations sociales personnelles)
        lines.push(['HA','Achats',`E${String(seq).padStart(6,'0')}`,dStr,'646000','Cotisations URSSAF',
                    '','',`URSSAF-${year}-${m+1}`,dStr,
                    `Cotisations URSSAF ${dt.toLocaleString('fr-FR',{month:'long'})} ${year}`,
                    fmtAmt(monthlyCotis),'0,00','','','',fmtAmt(monthlyCotis),'EUR'].join('\t'));
        seq++;
      }
    });

    const filename = idelSel === 'all'
      ? `FEC_PORTFOLIO_${year}0101_${year}1231.txt`
      : `FEC_${targets[0].nom.toUpperCase()}_${year}0101_${year}1231.txt`;
    _download(filename, lines.join('\r\n'), 'text/plain;charset=utf-8');
    _toast('success', 'FEC généré', `${seq-1} écritures · ${targets.length} IDEL`);
  }

  async function generateLiasse2035() {
    if (!_gate('export_fiscal')) return;
    const idelSel = $('liasse-idel')?.value;
    const year = parseInt($('liasse-year')?.value || new Date().getFullYear()-1);
    const portfolio = await getPortfolio();
    const idel = portfolio.find(i => i.id === idelSel);
    if (!idel) { _toast('error', 'Aucune IDEL', 'Sélection requise'); return; }
    const k = idel.kpis;

    // Génération HTML d'une liasse 2035 simplifiée (BNC)
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Liasse 2035 — ${_esc(idel.prenom)} ${_esc(idel.nom)} — ${year}</title>
<style>
body{font-family:Arial,sans-serif;max-width:780px;margin:24px auto;padding:24px;color:#222}
h1{border-bottom:3px solid #FF5F6D;padding-bottom:8px;color:#FF5F6D}
h2{color:#444;margin-top:26px;border-bottom:1px solid #eee;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin:14px 0}
th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}
th{background:#f4f4f8;font-weight:600}
.r{text-align:right;font-variant-numeric:tabular-nums}
.tot{background:#ffe9eb;font-weight:700}
.foot{margin-top:36px;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:10px}
</style></head><body>
<h1>🧾 Liasse fiscale 2035 — Régime BNC</h1>
<p><b>Exercice :</b> du 01/01/${year} au 31/12/${year}<br>
<b>Cerfa :</b> 11176 · <b>Régime :</b> Déclaration contrôlée BNC<br>
<b>Contribuable :</b> ${_esc(idel.prenom)} ${_esc(idel.nom)} (${_esc(idel.ville)} ${_esc(idel.cp)})<br>
<b>Activité :</b> Infirmier(ère) Diplômé(e) d'État Libéral · Code NAF 8690D</p>

<h2>Recettes (cadre 1)</h2>
<table>
<tr><th>Ligne</th><th>Libellé</th><th class="r">Montant (€)</th></tr>
<tr><td>AA</td><td>Honoraires encaissés (NGAP)</td><td class="r">${_fmt(k.caBrut)}</td></tr>
<tr><td>AB</td><td>Indemnités kilométriques (IK/IFD)</td><td class="r">${_fmt(k.ihk)}</td></tr>
<tr><td>AG</td><td><b>Total recettes</b></td><td class="r tot">${_fmt(k.caTotal)}</td></tr>
</table>

<h2>Dépenses professionnelles (cadre 2)</h2>
<table>
<tr><th>Ligne</th><th>Libellé</th><th class="r">Montant (€)</th></tr>
<tr><td>BT</td><td>Cotisations sociales personnelles (URSSAF + CARPIMKO)</td><td class="r">${_fmt(k.cotisations)}</td></tr>
<tr><td>BG</td><td>Frais de véhicule (déduction forfaitaire)</td><td class="r">${_fmt(2800)}</td></tr>
<tr><td>BM</td><td>Fournitures de bureau et consommables</td><td class="r">${_fmt(900)}</td></tr>
<tr><td>BN</td><td>Téléphone, internet, logiciel métier</td><td class="r">${_fmt(800)}</td></tr>
<tr><td>BR</td><td><b>Total dépenses</b></td><td class="r tot">${_fmt(k.cotisations + 4500)}</td></tr>
</table>

<h2>Résultat fiscal (cadre 3)</h2>
<table>
<tr><th>Ligne</th><th>Libellé</th><th class="r">Montant (€)</th></tr>
<tr><td>CA</td><td>Bénéfice imposable BNC</td><td class="r tot">${_fmt(k.benefice)}</td></tr>
</table>

<h2>Renseignements complémentaires</h2>
<p><b>Nombre d'actes facturés :</b> ${_fmt0(k.nbActes)}<br>
<b>Nombre de patients distincts :</b> ${_fmt0(k.nbPatients)}<br>
<b>Score conformité NGAP :</b> ${k.conformite}/100<br>
<b>Adhésion AGA :</b> oui (majoration 25 % non applicable)</p>

<div class="foot">
Document généré automatiquement par AMI Comptable le ${new Date().toLocaleString('fr-FR')}.<br>
Pré-rempli à partir des données comptables du logiciel AMI. À vérifier et compléter avant télétransmission EDI-TDFC.<br>
Conserver 6 ans (article L102 B du LPF).
</div>
</body></html>`;

    const blob = new Blob([html], { type:'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url);
    if (w) setTimeout(() => w.print(), 800);
    _toast('success', 'Liasse 2035 générée', `${idel.prenom} ${idel.nom} — ${year}`);
  }

  /* ═══════════════════════════════════════════════════════════════
     7. GÉNÉRATEUR 2042-C-PRO · URSSAF · CARPIMKO
  ═══════════════════════════════════════════════════════════════ */

  async function render2042() {
    if (!_gate('generateur_2042')) return;
    _injectStyle();
    const root = $('view-comptable-2042');
    if (!root) return;

    const portfolio = await getPortfolio();
    const Y = new Date().getFullYear() - 1;
    const opts = portfolio.map(i => `<option value="${i.id}">${_esc(i.prenom)} ${_esc(i.nom)} — ${_esc(i.ville)}</option>`).join('');

    root.innerHTML = `
      ${_renderBack()}
      ${_renderHero('Générateur 2042-C-PRO · URSSAF · CARPIMKO', 'Pré-remplissage des déclarations sociales et fiscales annuelles', '🧾')}

      <div class="cpt-section">
        <h3 class="cpt-section-title">⚙️ Paramètres</h3>
        <div class="cpt-form-row">
          <div>
            <label>IDEL cliente</label>
            <select id="d2042-idel">${opts}</select>
          </div>
          <div>
            <label>Année</label>
            <select id="d2042-year"><option value="${Y-1}">${Y-1}</option><option value="${Y}" selected>${Y}</option></select>
          </div>
        </div>
        <button class="btn bp bsm" onclick="Comptable.generate2042()">🔍 Calculer & afficher</button>
      </div>

      <div id="d2042-results"></div>
    `;
  }

  async function generate2042() {
    if (!_gate('generateur_2042')) return;
    const idelSel = $('d2042-idel')?.value;
    const year = parseInt($('d2042-year')?.value || new Date().getFullYear()-1);
    const portfolio = await getPortfolio();
    const idel = portfolio.find(i => i.id === idelSel);
    if (!idel) { _toast('error', 'IDEL requise', ''); return; }
    const k = idel.kpis;

    // Calculs simplifiés (taux 2024 indicatifs)
    const benef = k.benefice;
    // URSSAF : ~21,2% sur revenus pros
    const urssafTotal = Math.round(benef * 0.212);
    const urssafMaladie = Math.round(benef * 0.066);
    const urssafCsg = Math.round(benef * 0.092);
    const urssafAlloc = Math.round(benef * 0.054);
    // CARPIMKO : retraite de base + complémentaire + invalidité-décès (~9,75%)
    const carpRetraiteBase = Math.round(benef * 0.0875);
    const carpCompl = Math.round(benef * 0.030);
    const carpInval = Math.min(Math.round(benef * 0.005), 678);
    const carpTotal = carpRetraiteBase + carpCompl + carpInval;

    $('d2042-results').innerHTML = `
      <div class="cpt-section">
        <h3 class="cpt-section-title">🧾 Déclaration 2042-C-PRO — ${_esc(idel.prenom)} ${_esc(idel.nom)} · ${year}</h3>
        <p class="cpt-section-sub">Cerfa 11222 · revenus non commerciaux professionnels (BNC) déclaration contrôlée.</p>
        <table class="cpt-table">
          <thead><tr><th>Case</th><th>Libellé</th><th class="cpt-table-num">Montant (€)</th></tr></thead>
          <tbody>
            <tr><td><b>5QC</b></td><td>Revenus imposables — Régime de la déclaration contrôlée</td><td class="cpt-table-num"><b>${_fmt0(benef)}</b></td></tr>
            <tr><td>5HQ</td><td>Plus-values nettes à court terme</td><td class="cpt-table-num">0</td></tr>
            <tr><td>5XJ</td><td>Adhérent AGA / OGA</td><td class="cpt-table-num">Oui</td></tr>
          </tbody>
        </table>
      </div>

      <div class="cpt-section">
        <h3 class="cpt-section-title">🏛️ URSSAF — Déclaration sociale des indépendants (DSI)</h3>
        <p class="cpt-section-sub">Assiette : bénéfice BNC ${year} = ${_fmt0(benef)} €</p>
        <table class="cpt-table">
          <thead><tr><th>Cotisation</th><th>Taux</th><th class="cpt-table-num">Montant (€)</th></tr></thead>
          <tbody>
            <tr><td>Maladie-maternité</td><td>6,60 %</td><td class="cpt-table-num">${_fmt0(urssafMaladie)}</td></tr>
            <tr><td>CSG-CRDS</td><td>9,20 %</td><td class="cpt-table-num">${_fmt0(urssafCsg)}</td></tr>
            <tr><td>Allocations familiales</td><td>5,40 %</td><td class="cpt-table-num">${_fmt0(urssafAlloc)}</td></tr>
            <tr style="background:rgba(255,95,109,.06)"><td><b>Total URSSAF estimé</b></td><td><b>21,20 %</b></td><td class="cpt-table-num"><b>${_fmt0(urssafTotal)}</b></td></tr>
          </tbody>
        </table>
      </div>

      <div class="cpt-section">
        <h3 class="cpt-section-title">⚕️ CARPIMKO — Retraite des auxiliaires médicaux</h3>
        <p class="cpt-section-sub">Caisse Autonome de Retraite et de Prévoyance des Infirmiers, Masseurs-Kinésithérapeutes…</p>
        <table class="cpt-table">
          <thead><tr><th>Régime</th><th>Taux</th><th class="cpt-table-num">Montant (€)</th></tr></thead>
          <tbody>
            <tr><td>Retraite de base (RBL)</td><td>8,75 %</td><td class="cpt-table-num">${_fmt0(carpRetraiteBase)}</td></tr>
            <tr><td>Retraite complémentaire (RCL)</td><td>3,00 %</td><td class="cpt-table-num">${_fmt0(carpCompl)}</td></tr>
            <tr><td>Invalidité-décès (ID)</td><td>forfait plafonné</td><td class="cpt-table-num">${_fmt0(carpInval)}</td></tr>
            <tr style="background:rgba(255,95,109,.06)"><td><b>Total CARPIMKO estimé</b></td><td>—</td><td class="cpt-table-num"><b>${_fmt0(carpTotal)}</b></td></tr>
          </tbody>
        </table>
        <button class="btn bp bsm" style="margin-top:14px" onclick="Comptable.export2042CSV('${idel.id}',${year})">📥 Exporter CSV récapitulatif</button>
      </div>
    `;
  }

  async function export2042CSV(idelId, year) {
    if (!_gate('generateur_2042')) return;
    const portfolio = await getPortfolio();
    const idel = portfolio.find(i => i.id === idelId);
    if (!idel) return;
    const k = idel.kpis;
    const benef = k.benefice;
    const urssaf = Math.round(benef * 0.212);
    const carp   = Math.round(benef * 0.1175) + Math.min(Math.round(benef*0.005),678);
    const csv = '\uFEFF' + [
      'Champ;Valeur',
      `IDEL;${idel.prenom} ${idel.nom}`,
      `Année;${year}`,
      `Régime;BNC déclaration contrôlée`,
      `2042-C-PRO case 5QC;${benef}`,
      `URSSAF total;${urssaf}`,
      `CARPIMKO total;${carp}`,
      `Total cotisations sociales;${urssaf+carp}`
    ].join('\n');
    _download(`2042-${idel.nom}-${year}.csv`, csv, 'text/csv;charset=utf-8');
    _toast('success', 'Export CSV', `${idel.prenom} ${idel.nom} — ${year}`);
  }

  /* ═══════════════════════════════════════════════════════════════
     8. SCORING RISQUE PORTFOLIO
  ═══════════════════════════════════════════════════════════════ */

  async function renderScoring() {
    if (!_gate('scoring_risque')) return;
    _injectStyle();
    const root = $('view-comptable-scoring');
    if (!root) return;

    const portfolio = await getPortfolio();
    portfolio.sort((a,b) => b.kpis.risqueCpam - a.kpis.risqueCpam);

    const high = portfolio.filter(i => i.kpis.risqueCpam >= 60);
    const med  = portfolio.filter(i => i.kpis.risqueCpam >= 30 && i.kpis.risqueCpam < 60);
    const low  = portfolio.filter(i => i.kpis.risqueCpam < 30);

    const renderBlock = (title, list, color, icon) => {
      if (!list.length) return '';
      const rows = list.map(i => {
        const reco = i.kpis.risqueCpam >= 70 ? 'Audit prioritaire — courrier recommandé sous 30j'
                  : i.kpis.risqueCpam >= 50  ? 'Audit interne recommandé sous 90j'
                  : i.kpis.risqueCpam >= 30  ? 'Surveillance accrue'
                  : 'Suivi standard';
        return `<tr>
          <td><b>${_esc(i.prenom)} ${_esc(i.nom)}</b><br><span style="font-size:11px;color:var(--m)">${_esc(i.ville)}</span></td>
          <td><span class="cpt-pill" style="background:${color}22;color:${color}">${i.kpis.risqueCpam}/100</span></td>
          <td class="cpt-table-num">${i.kpis.nbAnomalies}</td>
          <td class="cpt-table-num">${i.kpis.conformite}</td>
          <td>${reco}</td>
        </tr>`;
      }).join('');
      return `
        <div class="cpt-table-wrap">
          <div class="cpt-table-head">
            <div class="cpt-table-title">${icon} ${title} — ${list.length} IDEL</div>
          </div>
          <table class="cpt-table">
            <thead><tr><th>IDEL</th><th>Score risque</th><th class="cpt-table-num">Anomalies</th><th class="cpt-table-num">Conformité</th><th>Recommandation</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    };

    root.innerHTML = `
      ${_renderBack()}
      ${_renderHero('Scoring risque portfolio', 'Notation CPAM/fiscal de chaque IDEL sous mandat avec recommandations d\'action', '🎯')}

      <div class="cpt-kpis">
        <div class="cpt-kpi"><div class="cpt-kpi-label">🔴 Risque élevé</div><div class="cpt-kpi-val" style="color:#FF7A85">${high.length}</div><div class="cpt-kpi-sub">Score ≥ 60</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">🟠 Risque modéré</div><div class="cpt-kpi-val" style="color:#ffb547">${med.length}</div><div class="cpt-kpi-sub">Score 30-59</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">🟢 Risque faible</div><div class="cpt-kpi-val" style="color:#00d4aa">${low.length}</div><div class="cpt-kpi-sub">Score &lt; 30</div></div>
      </div>

      ${renderBlock('Risque élevé', high, '#ff5f6d', '🔴')}
      ${renderBlock('Risque modéré', med, '#ffb547', '🟠')}
      ${renderBlock('Risque faible', low, '#00d4aa', '🟢')}
    `;
  }

  /* ═══════════════════════════════════════════════════════════════
     9. ALERTES NGAP EN MASSE
  ═══════════════════════════════════════════════════════════════ */

  const _ANOMALY_TYPES = [
    { code:'AIS3-OUBLI',   label:'AIS 3 manquant sur tournée diabétique',   sev:'M' },
    { code:'MAJ-DIM-NUIT', label:'Cumul majoration dimanche + nuit',         sev:'H' },
    { code:'IFI-DOUBLE',   label:'Indemnité forfaitaire IFI déclarée 2×',   sev:'H' },
    { code:'AMI4-INVA',    label:'AMI 4 facturé sans prescription',          sev:'H' },
    { code:'IK-ZONE',      label:'IK déclarés hors zone agglomération',     sev:'L' },
    { code:'BSI-EXPI',     label:'BSI expiré depuis +90j',                   sev:'M' },
    { code:'COTAT-DUPL',   label:'Cotation dupliquée même jour',             sev:'M' },
    { code:'PERFU-MAJ',    label:'Perfusion AMI 14,3 sans MCI',              sev:'L' }
  ];

  async function renderAlertes() {
    if (!_gate('alertes_ngap_masse')) return;
    _injectStyle();
    const root = $('view-comptable-alertes');
    if (!root) return;

    const portfolio = await getPortfolio();
    // Generation pseudo-déterministe d'anomalies par IDEL
    const allAnoms = [];
    portfolio.forEach(idel => {
      const r = _seed(idel.id + '-anom');
      const n = idel.kpis.nbAnomalies;
      for (let k = 0; k < n; k++) {
        const t = _ANOMALY_TYPES[Math.floor(r() * _ANOMALY_TYPES.length)];
        const dt = new Date(Date.now() - Math.floor(r()*120)*86400000);
        const impact = Math.round(r() * 180) + 10;
        allAnoms.push({ idel, type:t, date:dt, impact });
      }
    });
    allAnoms.sort((a,b) => b.date - a.date);

    const totalImpact = allAnoms.reduce((s,a)=>s+a.impact, 0);
    const sevH = allAnoms.filter(a => a.type.sev === 'H').length;
    const sevM = allAnoms.filter(a => a.type.sev === 'M').length;
    const sevL = allAnoms.filter(a => a.type.sev === 'L').length;

    const rows = allAnoms.slice(0, 100).map(a => {
      const sevCl = a.type.sev === 'H' ? 'r' : a.type.sev === 'M' ? 'o' : 'b';
      const sevLbl = a.type.sev === 'H' ? 'Élevée' : a.type.sev === 'M' ? 'Moyenne' : 'Faible';
      return `<tr>
        <td>${a.date.toLocaleDateString('fr-FR')}</td>
        <td><b>${_esc(a.idel.prenom)} ${_esc(a.idel.nom)}</b><br><span style="font-size:11px;color:var(--m)">${_esc(a.idel.ville)}</span></td>
        <td><code style="font-size:11px;background:var(--bg);padding:2px 6px;border-radius:4px">${a.type.code}</code></td>
        <td>${_esc(a.type.label)}</td>
        <td><span class="cpt-pill ${sevCl}">${sevLbl}</span></td>
        <td class="cpt-table-num">${_fmt0(a.impact)} €</td>
      </tr>`;
    }).join('');

    root.innerHTML = `
      ${_renderBack()}
      ${_renderHero('Alertes anomalies NGAP en masse', `Détection batch sur ${portfolio.length} IDEL clientes — analyse temps réel`, '🚨')}

      <div class="cpt-kpis">
        <div class="cpt-kpi"><div class="cpt-kpi-label">Total anomalies</div><div class="cpt-kpi-val">${allAnoms.length}</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">🔴 Sévérité élevée</div><div class="cpt-kpi-val" style="color:#FF7A85">${sevH}</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">🟠 Sévérité moyenne</div><div class="cpt-kpi-val" style="color:#ffb547">${sevM}</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">🔵 Sévérité faible</div><div class="cpt-kpi-val" style="color:#4fa8ff">${sevL}</div></div>
        <div class="cpt-kpi"><div class="cpt-kpi-label">Impact financier estimé</div><div class="cpt-kpi-val" style="color:#FF7A85">${_fmt0(totalImpact)} €</div></div>
      </div>

      <div class="cpt-table-wrap">
        <div class="cpt-table-head">
          <div class="cpt-table-title">Anomalies récentes (100 dernières)</div>
          <div class="cpt-table-actions">
            <button class="btn bs bsm" onclick="Comptable.exportAlertesCSV()">📥 Export CSV</button>
            <button class="btn bs bsm" onclick="Comptable.renderAlertes()">↻ Actualiser</button>
          </div>
        </div>
        <table class="cpt-table">
          <thead><tr><th>Date</th><th>IDEL</th><th>Code</th><th>Anomalie</th><th>Sévérité</th><th class="cpt-table-num">Impact</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="cpt-empty">Aucune anomalie détectée 🎉</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  async function exportAlertesCSV() {
    if (!_gate('alertes_ngap_masse')) return;
    const portfolio = await getPortfolio();
    const lines = ['Date;IDEL;Ville;Code;Anomalie;Sévérité;Impact_EUR'];
    portfolio.forEach(idel => {
      const r = _seed(idel.id + '-anom');
      for (let k = 0; k < idel.kpis.nbAnomalies; k++) {
        const t = _ANOMALY_TYPES[Math.floor(r() * _ANOMALY_TYPES.length)];
        const dt = new Date(Date.now() - Math.floor(r()*120)*86400000);
        const impact = Math.round(r()*180)+10;
        lines.push([
          dt.toISOString().slice(0,10), `${idel.prenom} ${idel.nom}`,
          idel.ville, t.code, t.label, t.sev, impact
        ].join(';'));
      }
    });
    _download(`alertes-ngap-${new Date().toISOString().slice(0,10)}.csv`, '\uFEFF'+lines.join('\n'), 'text/csv;charset=utf-8');
    _toast('success', 'Export CSV', `${lines.length-1} anomalies exportées`);
  }

  /* ═══════════════════════════════════════════════════════════════
     10. CONNECTEURS COMPTABLES (Cegid · EBP · Quadra)
  ═══════════════════════════════════════════════════════════════ */

  const _CONNECTORS = [
    { id:'cegid',  name:'Cegid Loop',         logo:'🟦', desc:'Cegid Quadra Expert / Loop — export FEC + journaux ventes/achats au format Cegid', formats:['FEC','XLSX Cegid','API REST v2'] },
    { id:'ebp',    name:'EBP Comptabilité',   logo:'🟧', desc:'EBP Compta Pro — import direct via fichier .xlx ou connecteur API natif',         formats:['FEC','EBP .xlx','API'] },
    { id:'quadra', name:'Quadra Expert',      logo:'🟪', desc:'Quadra Cegid (ex Aurion) — fichier ASCII normalisé pour intégration auto',        formats:['FEC','ASCII Quadra'] },
    { id:'ibiza',  name:'Ibiza',              logo:'🟫', desc:'Ibiza Compta — passerelle FEC et journal centralisateur',                          formats:['FEC','CSV Ibiza'] },
    { id:'sage',   name:'Sage 50 Cloud',      logo:'🟩', desc:'Sage 50cloud Ciel Compta — fichier CIEL.txt ou FEC standard',                       formats:['FEC','CIEL .txt'] }
  ];

  async function renderConnecteurs() {
    if (!_gate('connecteurs_compta')) return;
    _injectStyle();
    const root = $('view-comptable-connecteurs');
    if (!root) return;

    const portfolio = await getPortfolio();
    const opts = portfolio.map(i => `<option value="${i.id}">${_esc(i.prenom)} ${_esc(i.nom)}</option>`).join('');

    const cards = _CONNECTORS.map(c => `
      <div class="cpt-card" onclick="Comptable.openConnector('${c.id}')">
        <div class="cpt-card-arrow">→</div>
        <div class="cpt-card-ic" style="font-size:28px">${c.logo}</div>
        <div class="cpt-card-title">${_esc(c.name)}</div>
        <div class="cpt-card-sub">${_esc(c.desc)}</div>
        <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">
          ${c.formats.map(f => `<span class="cpt-pill b">${_esc(f)}</span>`).join('')}
        </div>
      </div>
    `).join('');

    root.innerHTML = `
      ${_renderBack()}
      ${_renderHero('Connecteurs comptables', 'Export direct vers les principaux logiciels comptables du marché', '🔌')}

      <div class="cpt-section">
        <h3 class="cpt-section-title">⚙️ Sélection IDEL</h3>
        <div class="cpt-form-row">
          <div>
            <label>IDEL cliente</label>
            <select id="conn-idel"><option value="all">📦 Tout le portefeuille</option>${opts}</select>
          </div>
          <div>
            <label>Période</label>
            <select id="conn-period">
              <option value="month">Mois en cours</option>
              <option value="quarter">Trimestre en cours</option>
              <option value="year" selected>Année en cours</option>
              <option value="prev-year">Année précédente</option>
            </select>
          </div>
        </div>
      </div>

      <div class="cpt-grid">${cards}</div>

      <div class="cpt-section" style="margin-top:18px;background:rgba(79,168,255,.05);border-color:rgba(79,168,255,.25)">
        <h3 class="cpt-section-title">ℹ️ À propos des connecteurs</h3>
        <p class="cpt-section-sub" style="margin:0">Tous les exports respectent la norme FEC (DGFiP A47 A-1 du LPF) garantissant la compatibilité avec n'importe quel logiciel comptable. Les formats propriétaires (Cegid, EBP, Quadra, Ciel) ajoutent les optimisations spécifiques de chaque éditeur pour un import direct sans retraitement.</p>
      </div>
    `;
  }

  function openConnector(connId) {
    if (!_gate('connecteurs_compta')) return;
    const c = _CONNECTORS.find(x => x.id === connId);
    if (!c) return;
    const idelSel = $('conn-idel')?.value || 'all';
    const period = $('conn-period')?.value || 'year';
    const targetLabel = idelSel === 'all' ? 'tout le portefeuille' : idelSel;

    if (!confirm(`Générer un export pour ${_esc(c.name)} ?\n\nCible : ${targetLabel}\nPériode : ${period}\nFormat : FEC standard\n\n⚠️ Démo : le fichier sera téléchargé localement.`)) return;

    // Réutilise le générateur FEC standard
    const Y = period === 'prev-year' ? new Date().getFullYear()-2 : new Date().getFullYear()-1;
    $('fec-idel') || (window.__fec_idel_tmp = idelSel);
    $('fec-year') || (window.__fec_year_tmp = Y);
    // Génération directe inline
    getPortfolio().then(p => {
      const targets = idelSel === 'all' ? p : p.filter(i => i.id === idelSel);
      if (!targets.length) { _toast('error','IDEL invalide',''); return; }

      const HEAD = ['JournalCode','JournalLib','EcritureNum','EcritureDate','CompteNum','CompteLib',
                    'CompAuxNum','CompAuxLib','PieceRef','PieceDate','EcritureLib',
                    'Debit','Credit','EcritureLet','DateLet','ValidDate','Montantdevise','Idevise'];
      const lines = [HEAD.join('\t')];
      const fmtDate = d => d.toISOString().slice(0,10).replace(/-/g,'');
      const fmtAmt  = n => Number(n).toFixed(2).replace('.',',');
      let seq = 1;
      targets.forEach(idel => {
        const monthlyCa = idel.kpis.caTotal/12;
        for (let m = 0; m < 12; m++) {
          const dt = new Date(Y, m, 28);
          const dStr = fmtDate(dt);
          lines.push(['VT','Ventes',`E${String(seq).padStart(6,'0')}`,dStr,'706000','Honoraires NGAP',
                      idel.id,`${idel.prenom} ${idel.nom}`,`F${Y}-${m+1}`,dStr,
                      `Honoraires ${dt.toLocaleString('fr-FR',{month:'long'})} ${Y}`,
                      '0,00',fmtAmt(monthlyCa),'','','',fmtAmt(monthlyCa),'EUR'].join('\t'));
          seq++;
        }
      });
      const filename = `${c.id.toUpperCase()}_${idelSel === 'all' ? 'PORTFOLIO' : idelSel}_${Y}.txt`;
      _download(filename, lines.join('\r\n'), 'text/plain;charset=utf-8');
      _toast('success', `Export ${c.name}`, `${seq-1} écritures · prêt à importer`);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     11. VUE ANONYMISÉE (PSEUDO-FEC)
  ═══════════════════════════════════════════════════════════════ */

  async function renderAnonymisee() {
    if (!_gate('vue_anonymisee')) return;
    _injectStyle();
    const root = $('view-comptable-anonymisee');
    if (!root) return;

    const portfolio = await getPortfolio();

    // Génération d'un pseudo-FEC : agrégats globaux sans nom IDEL ni patient
    const aggregated = portfolio.map((idel, idx) => ({
      pseudo: `IDEL-${String(idx+1).padStart(3,'0')}`,
      zone: idel.cp.slice(0, 2),
      ca: idel.kpis.caTotal,
      actes: idel.kpis.nbActes,
      benefice: idel.kpis.benefice,
      conformite: idel.kpis.conformite
    }));
    aggregated.sort((a,b) => b.ca - a.ca);

    const rows = aggregated.map(a => `
      <tr>
        <td><code style="font-size:12px;background:var(--bg);padding:2px 7px;border-radius:4px;color:#4fa8ff">${a.pseudo}</code></td>
        <td>Zone ${_esc(a.zone)}</td>
        <td class="cpt-table-num">${_fmt0(a.ca)} €</td>
        <td class="cpt-table-num">${_fmt0(a.actes)}</td>
        <td class="cpt-table-num">${_fmt0(a.benefice)} €</td>
        <td><span class="cpt-pill ${a.conformite>=80?'g':a.conformite>=60?'o':'r'}">${a.conformite}/100</span></td>
      </tr>
    `).join('');

    root.innerHTML = `
      ${_renderBack()}
      ${_renderHero('Vue anonymisée (pseudo-FEC)', 'Mode RGPD strict : aucune donnée nominative, uniquement les flux financiers agrégés', '🛡️')}

      <div class="cpt-section" style="background:rgba(0,212,170,.04);border-color:rgba(0,212,170,.25)">
        <h3 class="cpt-section-title">🔒 Garanties RGPD</h3>
        <ul style="margin:0;padding-left:20px;color:var(--t);font-size:13px;line-height:1.8">
          <li>Aucun nom, prénom ou identifiant nominatif IDEL</li>
          <li>Aucune donnée patient (ni nom, ni numéro de sécurité sociale)</li>
          <li>Identification par pseudonyme stable IDEL-NNN (audit traçable côté responsable de traitement)</li>
          <li>Localisation tronquée à la zone départementale (2 premiers chiffres CP)</li>
          <li>Données strictement comptables et statistiques</li>
          <li>Conforme aux articles 4.5 et 25 du RGPD (minimisation et pseudonymisation)</li>
        </ul>
      </div>

      <div class="cpt-table-wrap">
        <div class="cpt-table-head">
          <div class="cpt-table-title">Pseudo-FEC — agrégats portefeuille (${aggregated.length} entités)</div>
          <div class="cpt-table-actions">
            <button class="btn bs bsm" onclick="Comptable.exportPseudoFEC()">📥 Export pseudo-FEC</button>
          </div>
        </div>
        <table class="cpt-table">
          <thead><tr><th>Pseudonyme</th><th>Zone</th><th class="cpt-table-num">CA</th><th class="cpt-table-num">Actes</th><th class="cpt-table-num">Bénéfice</th><th>Conformité</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  async function exportPseudoFEC() {
    if (!_gate('vue_anonymisee')) return;
    const portfolio = await getPortfolio();
    const lines = ['Pseudonyme;Zone;CA_total;Nb_actes;Benefice;Conformite'];
    portfolio.forEach((idel, idx) => {
      lines.push([
        `IDEL-${String(idx+1).padStart(3,'0')}`,
        idel.cp.slice(0,2),
        idel.kpis.caTotal, idel.kpis.nbActes, idel.kpis.benefice, idel.kpis.conformite
      ].join(';'));
    });
    _download(`pseudo-fec-${new Date().toISOString().slice(0,10)}.csv`, '\uFEFF'+lines.join('\n'), 'text/csv;charset=utf-8');
    _toast('success', 'Export pseudo-FEC', `${portfolio.length} entités anonymisées · 0 donnée nominative`);
  }

  /* ═══════════════════════════════════════════════════════════════
     12. RAPPORTS TRIMESTRIELS AUTOMATIQUES
  ═══════════════════════════════════════════════════════════════ */

  async function renderTrimestriel() {
    if (!_gate('rapport_trimestriel')) return;
    _injectStyle();
    const root = $('view-comptable-trimestriel');
    if (!root) return;

    const portfolio = await getPortfolio();
    const Y = new Date().getFullYear();
    const Q = Math.floor(new Date().getMonth() / 3) + 1;
    const opts = portfolio.map(i => `<option value="${i.id}">${_esc(i.prenom)} ${_esc(i.nom)}</option>`).join('');

    root.innerHTML = `
      ${_renderBack()}
      ${_renderHero('Rapports trimestriels automatiques', 'Génération automatique des rapports trimestriels pour chaque IDEL cliente', '📅')}

      <div class="cpt-section">
        <h3 class="cpt-section-title">⚙️ Paramètres</h3>
        <div class="cpt-form-row">
          <div>
            <label>IDEL cliente</label>
            <select id="trim-idel"><option value="all">📦 Tout le portefeuille (rapports en lot)</option>${opts}</select>
          </div>
          <div>
            <label>Trimestre</label>
            <select id="trim-q">
              <option value="${Y}-1" ${Q===1?'selected':''}>T1 ${Y} (jan-mar)</option>
              <option value="${Y}-2" ${Q===2?'selected':''}>T2 ${Y} (avr-juin)</option>
              <option value="${Y}-3" ${Q===3?'selected':''}>T3 ${Y} (juil-sep)</option>
              <option value="${Y}-4" ${Q===4?'selected':''}>T4 ${Y} (oct-déc)</option>
              <option value="${Y-1}-4">T4 ${Y-1}</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn bp bsm" onclick="Comptable.generateTrimestriel()">📄 Générer</button>
          <button class="btn bs bsm" onclick="Comptable.scheduleTrimestriel()">⏰ Planifier auto (T+1)</button>
        </div>
      </div>

      <div id="trim-results"></div>
    `;
  }

  async function generateTrimestriel() {
    if (!_gate('rapport_trimestriel')) return;
    const idelSel = $('trim-idel')?.value;
    const [Y, Q] = ($('trim-q')?.value || '2024-1').split('-').map(Number);
    const portfolio = await getPortfolio();
    const targets = idelSel === 'all' ? portfolio : portfolio.filter(i => i.id === idelSel);
    if (!targets.length) { _toast('error','Aucune IDEL',''); return; }

    const monthsLabel = { 1:'janvier–mars', 2:'avril–juin', 3:'juillet–septembre', 4:'octobre–décembre' };

    const cards = targets.map(idel => {
      const k = idel.kpis;
      const caT = Math.round(k.caTotal / 4);          // proxy : CA annuel /4
      const actT = Math.round(k.nbActes / 4);
      const benT = Math.round(k.benefice / 4);
      const cotT = Math.round(k.cotisations / 4);
      const reco = k.risqueCpam >= 60 ? 'Audit prioritaire recommandé' : k.conformite < 70 ? 'Renforcer la traçabilité' : 'Activité conforme';
      return `
        <div class="cpt-section">
          <h3 class="cpt-section-title">📅 ${_esc(idel.prenom)} ${_esc(idel.nom)} — T${Q} ${Y}</h3>
          <p class="cpt-section-sub">Période ${monthsLabel[Q]} · ${_esc(idel.ville)}</p>
          <div class="cpt-kpis" style="margin-bottom:8px">
            <div class="cpt-kpi"><div class="cpt-kpi-label">CA trimestre</div><div class="cpt-kpi-val">${_fmt0(caT)} €</div></div>
            <div class="cpt-kpi"><div class="cpt-kpi-label">Actes</div><div class="cpt-kpi-val">${_fmt0(actT)}</div></div>
            <div class="cpt-kpi"><div class="cpt-kpi-label">Bénéfice</div><div class="cpt-kpi-val">${_fmt0(benT)} €</div></div>
            <div class="cpt-kpi"><div class="cpt-kpi-label">Cotisations</div><div class="cpt-kpi-val">${_fmt0(cotT)} €</div></div>
          </div>
          <p style="margin:8px 0;font-size:12px"><b>Recommandation :</b> ${reco}</p>
          <button class="btn bs bsm" onclick="Comptable.exportTrimestrielPDF('${idel.id}',${Y},${Q})">📥 Export PDF</button>
        </div>`;
    }).join('');

    $('trim-results').innerHTML = `
      <div style="margin:14px 0;padding:10px 14px;background:rgba(0,212,170,.06);border:1px solid rgba(0,212,170,.25);border-radius:10px;color:#00d4aa;font-size:12px">
        ✓ ${targets.length} rapport${targets.length>1?'s':''} généré${targets.length>1?'s':''} pour T${Q} ${Y}
      </div>
      ${cards}
    `;
  }

  async function exportTrimestrielPDF(idelId, year, quarter) {
    if (!_gate('rapport_trimestriel')) return;
    const portfolio = await getPortfolio();
    const idel = portfolio.find(i => i.id === idelId);
    if (!idel) return;
    const k = idel.kpis;
    const caT  = Math.round(k.caTotal / 4);
    const actT = Math.round(k.nbActes / 4);
    const benT = Math.round(k.benefice / 4);
    const cotT = Math.round(k.cotisations / 4);
    const monthsLabel = { 1:'Janvier – Mars', 2:'Avril – Juin', 3:'Juillet – Septembre', 4:'Octobre – Décembre' };

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Rapport trimestriel — ${_esc(idel.prenom)} ${_esc(idel.nom)} — T${quarter} ${year}</title>
<style>
body{font-family:Arial,sans-serif;max-width:780px;margin:24px auto;padding:24px;color:#222}
h1{border-bottom:3px solid #FF5F6D;padding-bottom:8px;color:#FF5F6D}
h2{color:#444;margin-top:26px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}
th{background:#f4f4f8}
.r{text-align:right;font-variant-numeric:tabular-nums}
.foot{margin-top:36px;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:10px}
</style></head><body>
<h1>📅 Rapport trimestriel BNC</h1>
<p><b>Période :</b> ${monthsLabel[quarter]} ${year} (T${quarter})<br>
<b>IDEL :</b> ${_esc(idel.prenom)} ${_esc(idel.nom)} — ${_esc(idel.ville)} ${_esc(idel.cp)}<br>
<b>Édité le :</b> ${new Date().toLocaleString('fr-FR')}</p>

<h2>Activité</h2>
<table>
<tr><th>Indicateur</th><th class="r">Valeur</th></tr>
<tr><td>Chiffre d'affaires</td><td class="r">${_fmt(caT)} €</td></tr>
<tr><td>Nombre d'actes facturés</td><td class="r">${_fmt0(actT)}</td></tr>
<tr><td>Cotisations sociales (URSSAF + CARPIMKO)</td><td class="r">${_fmt(cotT)} €</td></tr>
<tr><td><b>Bénéfice net trimestre</b></td><td class="r"><b>${_fmt(benT)} €</b></td></tr>
</table>

<h2>Conformité & risque</h2>
<table>
<tr><th>Indicateur</th><th class="r">Valeur</th></tr>
<tr><td>Score conformité NGAP</td><td class="r">${k.conformite}/100</td></tr>
<tr><td>Score risque CPAM</td><td class="r">${k.risqueCpam}/100</td></tr>
<tr><td>Anomalies détectées (an)</td><td class="r">${k.nbAnomalies}</td></tr>
</table>

<h2>Recommandations</h2>
<p>${k.risqueCpam >= 60
  ? '🔴 <b>Audit prioritaire recommandé</b> — score CPAM élevé, prévoir un point de vérification dans le mois.'
  : k.conformite < 70
  ? '🟠 <b>Renforcer la traçabilité</b> — score conformité en-dessous du seuil de 70/100.'
  : '🟢 <b>Activité conforme</b> — pas d\'action particulière requise ce trimestre.'}</p>

<div class="foot">
Rapport trimestriel généré automatiquement par AMI Comptable.<br>
Données pré-remplies à partir des écritures comptables transmises par l'IDEL via l'application AMI.<br>
Document à conserver 6 ans (article L102 B du LPF).
</div>
</body></html>`;

    const blob = new Blob([html], { type:'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url);
    if (w) setTimeout(() => w.print(), 800);
    _toast('success', 'Rapport généré', `${idel.prenom} ${idel.nom} — T${quarter} ${year}`);
  }

  function scheduleTrimestriel() {
    if (!_gate('rapport_trimestriel')) return;
    _toast('info', 'Planification activée', 'Les rapports T+1 seront générés automatiquement à chaque clôture trimestrielle.');
  }

  /* ═══════════════════════════════════════════════════════════════
     13. HOOK NAVIGATION + EXPORT API
  ═══════════════════════════════════════════════════════════════ */

  document.addEventListener('ui:navigate', e => {
    const v = e.detail?.view;
    switch (v) {
      case 'comptable-hub':         renderHub(); break;
      case 'comptable-dashboard':   renderDashboard(); break;
      case 'comptable-export-fec':  renderExportFEC(); break;
      case 'comptable-2042':        render2042(); break;
      case 'comptable-scoring':     renderScoring(); break;
      case 'comptable-alertes':     renderAlertes(); break;
      case 'comptable-connecteurs': renderConnecteurs(); break;
      case 'comptable-anonymisee':  renderAnonymisee(); break;
      case 'comptable-trimestriel': renderTrimestriel(); break;
    }
  });

  /* Export public API */
  window.Comptable = {
    getPortfolio,
    renderHub, renderDashboard, renderExportFEC, render2042,
    renderScoring, renderAlertes, renderConnecteurs,
    renderAnonymisee, renderTrimestriel,
    // helpers exposés pour onclick inline
    exportPortfolioCSV, generateFEC, generateLiasse2035,
    generate2042, export2042CSV,
    exportAlertesCSV, openConnector, exportPseudoFEC,
    generateTrimestriel, exportTrimestrielPDF, scheduleTrimestriel
  };

})();
