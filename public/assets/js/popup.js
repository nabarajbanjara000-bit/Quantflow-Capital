/* ==========================================================
   Quant Flow Capital — Floating Research Collaboration Popup
   ========================================================== */
(function () {
  // Do not show on /connect/ page since it is already dedicated to Research Collaboration
  if (window.location.pathname.replace(/\/$/, '') === '/connect') return;

  // Check if manually dismissed during this session
  if (sessionStorage.getItem('qfc_collab_dismissed') === '1') return;

  function injectPopupStyles() {
    if (document.getElementById('qfc-popup-style')) return;
    const style = document.createElement('style');
    style.id = 'qfc-popup-style';
    style.textContent = `
      .qfc-popup {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 410px;
        max-width: calc(100vw - 32px);
        z-index: 9999;
        opacity: 0;
        visibility: hidden;
        transform: translateY(28px) scale(0.96);
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease, visibility 0.35s ease;
        pointer-events: none;
      }
      .qfc-popup.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      .qfc-popup.dismissing {
        opacity: 0;
        transform: translateY(20px) scale(0.96);
        pointer-events: none;
      }
      .qfc-popup-card {
        position: relative;
        background: #ffffff;
        border: 1px solid #e4e1d9;
        border-radius: 12px;
        padding: 24px 24px 22px;
        box-shadow: 0 18px 40px -12px rgba(10, 23, 41, 0.22), 0 2px 8px rgba(10, 23, 41, 0.06);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .qfc-popup-close {
        position: absolute;
        top: 14px;
        right: 14px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: #7a889b;
        border-radius: 50%;
        cursor: pointer;
        transition: background-color 0.15s, color 0.15s;
        padding: 0;
      }
      .qfc-popup-close:hover {
        background: #f1f3f7;
        color: #0e1a2b;
      }
      .qfc-popup-tag {
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.12em;
        color: #b08d57;
        text-transform: uppercase;
        margin-bottom: 8px;
        padding-right: 28px;
      }
      .qfc-popup-title {
        font-family: "Source Serif 4", "Source Serif Pro", Georgia, serif;
        font-size: 19px;
        font-weight: 550;
        line-height: 1.25;
        color: #0e1a2b;
        margin: 0 0 10px;
        padding-right: 20px;
        letter-spacing: -0.01em;
      }
      .qfc-popup-desc {
        font-size: 13px;
        line-height: 1.55;
        color: #3b4858;
        margin: 0 0 12px;
      }
      .qfc-popup-list {
        padding-left: 17px;
        margin: 0 0 16px;
        font-size: 12.5px;
        line-height: 1.6;
        color: #3b4858;
      }
      .qfc-popup-list li {
        margin-bottom: 4px;
      }
      .qfc-popup-actions {
        display: flex;
        align-items: center;
      }
      .qfc-popup-btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        background: #0a1729;
        color: #ffffff;
        padding: 10px 18px;
        font-size: 12.5px;
        font-weight: 600;
        border-radius: 6px;
        text-decoration: none;
        transition: background-color 0.15s, transform 0.15s, box-shadow 0.15s;
      }
      .qfc-popup-btn:hover {
        background: #11233b;
        color: #ffffff;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(10, 23, 41, 0.2);
      }
      @media (max-width: 480px) {
        .qfc-popup {
          bottom: 14px;
          right: 14px;
          left: 14px;
          width: auto;
          max-width: none;
        }
        .qfc-popup-card {
          padding: 20px 18px 18px;
        }
        .qfc-popup-title {
          font-size: 17px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function initPopup() {
    if (document.getElementById('qfcCollabPopup')) return;
    injectPopupStyles();

    const popup = document.createElement('aside');
    popup.className = 'qfc-popup';
    popup.id = 'qfcCollabPopup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Research Collaboration Invitation');
    popup.setAttribute('aria-hidden', 'true');

    popup.innerHTML = `
      <div class="qfc-popup-card">
        <button type="button" class="qfc-popup-close" id="qfcPopupClose" aria-label="Close popup">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div class="qfc-popup-tag">01 / RESEARCH COLLABORATION</div>
        <h3 class="qfc-popup-title">Interested in macro and geopolitics?</h3>
        <p class="qfc-popup-desc">We want to meet people who enjoy investigating how economic policy and world events affect the market, and who can support their views with clear reasoning and credible sources:</p>
        <ul class="qfc-popup-list">
          <li>Macroeconomics and central bank policy</li>
          <li>Geopolitics, trade, energy, and supply chains</li>
          <li>Market implications, scenarios, and research writing</li>
        </ul>
        <div class="qfc-popup-actions">
          <a class="qfc-popup-btn" href="mailto:research@quantflowcapital.com?subject=Research%20Collaboration%20%E2%80%94%20Quant%20Flow">
            <span>Discuss Research Collaboration</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>
        </div>
      </div>
    `;

    document.body.appendChild(popup);

    const closeBtn = document.getElementById('qfcPopupClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        popup.classList.remove('show');
        popup.classList.add('dismissing');
        popup.setAttribute('aria-hidden', 'true');
        sessionStorage.setItem('qfc_collab_dismissed', '1');
        setTimeout(function () {
          if (popup.parentNode) {
            popup.parentNode.removeChild(popup);
          }
        }, 450);
      });
    }

    // Trigger smooth entrance animation after page opens
    setTimeout(function () {
      popup.classList.add('show');
      popup.setAttribute('aria-hidden', 'false');
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
  } else {
    initPopup();
  }
})();
