/**
 * ABOUTME: Playwright script to capture a preview screenshot of the web UI.
 * Injects mock evolution data so the UI renders with realistic content.
 * Run: bunx playwright chromium && bun src/ui/preview.ts
 */

import { chromium } from 'playwright';

const MOCK_STATE = {
  appId: 'castalia',
  appName: 'Castalia',
  status: 'scoring',
  currentVersion: 4,
  blueprint: {
    vision: 'A shared virtual space with calendar, video calls, and spatial navigation',
    criteria: [
      { id: 'AC-1', description: 'Calendar displays weekly view', priority: 'P0', met: true },
      { id: 'AC-2', description: 'Events can be created with drag', priority: 'P0', met: true },
      { id: 'AC-3', description: 'Video orbs render in Phaser scene', priority: 'P1', met: true },
      { id: 'AC-4', description: 'Theme system with 18 civilizations', priority: 'P1', met: true },
      { id: 'AC-5', description: 'Sound effects for calendar actions', priority: 'P2', met: true },
      { id: 'AC-6', description: 'Deep links open correct views', priority: 'P1', met: false },
      { id: 'AC-7', description: 'Mobile responsive layout', priority: 'P2', met: false },
      { id: 'AC-8', description: 'Keyboard navigation support', priority: 'P2', met: false },
    ],
    constraints: [],
    outOfScope: [],
    metadata: { createdAt: '2026-01-15T00:00:00Z', lastModified: '2026-02-10T00:00:00Z', version: 5 },
  },
  versions: [
    { version: 1, timestamp: '2026-01-20T14:30:00Z', gitTag: 'v0.1', criteriaMetBefore: [], criteriaMetAfter: ['AC-1'], criteriaDelta: ['AC-1'], selectedAgent: 'claude', qualityScore: 85, durationMs: 45000, screenshotPath: null, reportPath: 'evolution/reports/v0.0-to-v0.1.md' },
    { version: 2, timestamp: '2026-01-25T11:00:00Z', gitTag: 'v0.2', criteriaMetBefore: ['AC-1'], criteriaMetAfter: ['AC-1', 'AC-2'], criteriaDelta: ['AC-2'], selectedAgent: 'kimi', qualityScore: 78, durationMs: 62000, screenshotPath: null, reportPath: 'evolution/reports/v0.1-to-v0.2.md' },
    { version: 3, timestamp: '2026-02-01T16:45:00Z', gitTag: 'v0.3', criteriaMetBefore: ['AC-1', 'AC-2'], criteriaMetAfter: ['AC-1', 'AC-2', 'AC-3'], criteriaDelta: ['AC-3'], selectedAgent: 'claude', qualityScore: 91, durationMs: 38000, screenshotPath: null, reportPath: 'evolution/reports/v0.2-to-v0.3.md' },
    { version: 4, timestamp: '2026-02-08T09:15:00Z', gitTag: 'v0.4', criteriaMetBefore: ['AC-1', 'AC-2', 'AC-3'], criteriaMetAfter: ['AC-1', 'AC-2', 'AC-3', 'AC-4', 'AC-5'], criteriaDelta: ['AC-4', 'AC-5'], selectedAgent: 'kimi', qualityScore: 82, durationMs: 95000, screenshotPath: null, reportPath: 'evolution/reports/v0.3-to-v0.4.md' },
  ],
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // Wait for React to mount
  await page.waitForSelector('#root', { timeout: 5000 });
  await page.waitForTimeout(1000);

  // Inject mock data by dispatching to the React state
  await page.evaluate((mockState) => {
    // Find the React root and force-render with mock data
    const root = document.getElementById('root');
    if (root) {
      // The simplest approach: override the WebSocket to inject mock state
      // Since the app shows "Waiting for connection" without WS, we'll inject directly
      root.innerHTML = '';

      // Create a mock rendering
      const html = `
        <div>
          <header class="header">
            <h1>ChoraForge</h1>
            <div class="connection-indicator">
              <div class="connection-dot connected"></div>
              Connected (mock)
            </div>
          </header>
          <div class="container">
            <h2 style="font-size:15px;color:var(--text-secondary);margin:16px 0;font-weight:500">Apps</h2>
            <div class="grid grid-3">
              <div class="card" style="cursor:pointer">
                <div class="card-header">
                  <span class="card-title">${mockState.appName}</span>
                  <span class="badge badge-${mockState.status}">
                    <span class="status-dot ${mockState.status}"></span>
                    ${mockState.status.toUpperCase()}
                  </span>
                </div>
                <div class="text-sm text-muted" style="margin-bottom:8px">
                  v0.${mockState.currentVersion} → v0.${mockState.currentVersion + 1} evolving...
                </div>
                <div style="display:flex;gap:12px;align-items:center">
                  <span class="text-xs font-mono text-muted">${mockState.blueprint.criteria.filter((c: any) => c.met).length}/${mockState.blueprint.criteria.length}</span>
                  <div class="progress-bar" style="flex:1">
                    <div class="progress-fill" style="width:${Math.round(mockState.blueprint.criteria.filter((c: any) => c.met).length / mockState.blueprint.criteria.length * 100)}%"></div>
                  </div>
                  <span class="text-xs font-mono text-muted">${Math.round(mockState.blueprint.criteria.filter((c: any) => c.met).length / mockState.blueprint.criteria.length * 100)}%</span>
                </div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px">
              <!-- Timeline -->
              <div class="card">
                <div class="card-header"><span class="card-title">Version Timeline</span></div>
                <div class="timeline">
                  <div class="timeline-item" style="opacity:0.8">
                    <div class="timeline-dot active"></div>
                    <div class="timeline-header">
                      <span class="timeline-version">v0.5</span>
                      <span class="text-xs" style="color:var(--accent)">EVOLVING</span>
                    </div>
                    <div class="timeline-detail">Scoring variants...</div>
                  </div>
                  ${[...mockState.versions].reverse().map((v: any) => `
                    <div class="timeline-item">
                      <div class="timeline-dot complete"></div>
                      <div class="timeline-header">
                        <span class="timeline-version">${v.gitTag}</span>
                        <span class="timeline-time">${new Date(v.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <span class="timeline-time">${Math.round(v.durationMs / 1000)}s</span>
                      </div>
                      <div class="timeline-detail">
                        ${v.criteriaDelta.length} criteria met — ${v.selectedAgent} won, score ${v.qualityScore}
                      </div>
                      <div class="timeline-criteria">
                        ${v.criteriaDelta.map((id: string) => `<span class="criteria-chip new">${id}</span>`).join('')}
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

              <!-- Blueprint -->
              <div class="card">
                <div class="card-header">
                  <span class="card-title">Blueprint Progress</span>
                  <span class="font-mono text-sm" style="color:var(--text-secondary)">
                    ${mockState.blueprint.criteria.filter((c: any) => c.met).length}/${mockState.blueprint.criteria.length} criteria (${Math.round(mockState.blueprint.criteria.filter((c: any) => c.met).length / mockState.blueprint.criteria.length * 100)}%)
                  </span>
                </div>
                <div class="progress-bar" style="margin-bottom:8px">
                  <div class="progress-fill" style="width:${Math.round(mockState.blueprint.criteria.filter((c: any) => c.met).length / mockState.blueprint.criteria.length * 100)}%"></div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
                  ${mockState.blueprint.criteria.map((c: any) => `
                    <div style="display:flex;gap:12px;align-items:flex-start">
                      <span style="font-size:14px;width:18px;text-align:center;flex-shrink:0;margin-top:1px">${c.met ? '✓' : '•'}</span>
                      <span class="criteria-chip ${c.met ? 'met' : 'unmet'}" style="flex-shrink:0">${c.id} [${c.priority}]</span>
                      <span class="text-sm" style="color:${c.met ? 'var(--text-secondary)' : 'var(--text-primary)'};text-decoration:${c.met ? 'line-through' : 'none'};opacity:${c.met ? '0.6' : '1'}">${c.description}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      root.innerHTML = html;
    }
  }, MOCK_STATE);

  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'docs/screenshots/web-ui-preview.png',
    fullPage: true,
  });

  console.log('Screenshot saved to docs/screenshots/web-ui-preview.png');
  await browser.close();
}

main().catch(console.error);
