// Person E — GreenField Panel (WebviewPanel)
// Per-endpoint breakdown: live vs dead fields, waste score
import * as vscode from 'vscode';
import { FieldSet } from '../types';

export class GreenFieldPanel {
  public static currentPanel: GreenFieldPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'reveal':
            this.revealFileInEditor(message.uri, message.line);
            return;
        }
      },
      null,
      this._disposables
    );
  }

  private async revealFileInEditor(uriString: string, line: number) {
    try {
      const uri = vscode.Uri.parse(uriString);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false
      });
      
      const maxLine = doc.lineCount > 0 ? doc.lineCount - 1 : 0;
      const safeLine = Number.isFinite(line) ? Math.min(Math.max(0, line), maxLine) : 0;
      const pos = new vscode.Position(safeLine, 0);
      const selection = new vscode.Selection(pos, pos);
      editor.selection = selection;
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      vscode.window.showErrorMessage(`GreenField: Could not open file - ${uriString}`);
    }
  }

  public static createOrShow(extensionUri: vscode.Uri): GreenFieldPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
  
    if (GreenFieldPanel.currentPanel) {
      GreenFieldPanel.currentPanel._panel.reveal(column);
      return GreenFieldPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'greenfieldPanel',
      '🌱 GreenField Dashboard',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri]
      }
    );

    GreenFieldPanel.currentPanel = new GreenFieldPanel(panel);
    return GreenFieldPanel.currentPanel;
  }

  public update(fieldSets: FieldSet[]): void {
    const webview = this._panel.webview;
    this._panel.title = '🌱 GreenField Dashboard';
    this._panel.webview.html = this.getHtmlForWebview(webview, fieldSets);
  }

  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private getHtmlForWebview(webview: vscode.Webview, fieldSets: FieldSet[]): string {
    const nonce = this.getNonce();
    let totalWaste = 0;
    
    // Safety check just in case endpoints passed is undefined/null
    const safeFieldSets = Array.isArray(fieldSets) ? fieldSets : [];

    const rows = safeFieldSets.flatMap(fs => 
      fs.deadFields?.map(df => {
        totalWaste += df.wasteScore;
        const uriString = typeof df.definedAt === 'string' ? df.definedAt : df.definedAt.uri.toString();
        const startLine = typeof df.definedAt === 'string' ? 0 : df.definedAt.range.startLine;
        
        const safePattern = this.escapeHtml(fs.endpoint?.pattern || 'Unknown Endpoint');
        const safeMethod = this.escapeHtml(fs.endpoint?.method || 'N/A');
        const safeName = this.escapeHtml(df.name);
        const safeUri = this.escapeHtml(uriString);
        
        return `
          <tr>
            <td><code>${safePattern}</code> <span class="badge ${safeMethod.toLowerCase()}">${safeMethod}</span></td>
            <td><code>${safeName}</code></td>
            <td class="waste-score">${df.wasteScore} bytes</td>
            <td>
              <button class="reveal-btn" data-uri="${safeUri}" data-line="${startLine}">
                Jump to file
              </button>
            </td>
          </tr>
        `;
      }) || []
    ).join('');

    const co2Estimate = (totalWaste * 0.000000001 * 0.2).toFixed(10); // arbitrary formulation based on bytes

    const emptyState = rows.length === 0 
      ? `<tr><td colspan="4" class="empty-state">🎉 You have zero dead fields! Your data is fully sustainable.</td></tr>`
      : rows;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>GreenField Report</title>
          <style>
              body {
                  font-family: var(--vscode-font-family);
                  color: var(--vscode-editor-foreground);
                  background-color: var(--vscode-editor-background);
                  padding: 20px;
                  line-height: 1.6;
              }
              h1 { color: #4CAF50; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
              .summary-cards {
                  display: flex;
                  gap: 20px;
                  margin: 20px 0;
              }
              .card {
                  background: var(--vscode-editorWidget-background);
                  border: 1px solid var(--vscode-widget-border);
                  border-radius: 8px;
                  padding: 20px;
                  flex: 1;
                  text-align: center;
                  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              }
              .card.accent {
                  border: 2px solid #4CAF50;
                  background: rgba(76, 175, 80, 0.1);
              }
              .card h3 { margin: 0 0 10px 0; font-size: 14px; opacity: 0.8; }
              .card .value { font-size: 28px; font-weight: bold; margin: 0; color: #4CAF50;}
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th, td { text-align: left; padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
              th { background-color: var(--vscode-editorWidget-background); }
              .waste-score { color: #f44336; font-weight: bold; }
              .badge {
                  padding: 3px 6px;
                  border-radius: 4px;
                  font-size: 11px;
                  font-weight: bold;
              }
              .badge.get { background: #61dafb; color: #000; }
              .badge.post { background: #4caf50; color: #fff; }
              .badge.put { background: #ff9800; color: #fff; }
              .badge.delete { background: #f44336; color: #fff; }
              button {
                  background: var(--vscode-button-background);
                  color: var(--vscode-button-foreground);
                  border: none;
                  padding: 6px 12px;
                  cursor: pointer;
                  border-radius: 4px;
              }
              button:hover { background: var(--vscode-button-hoverBackground); }
              .empty-state { text-align: center; color: #4CAF50; font-style: italic; padding: 30px !important; }
              code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; }
          </style>
      </head>
      <body>
          <h1>🌱 Sustainable Software Engineering Dashboard</h1>
          
          <div class="summary-cards">
              <div class="card">
                  <h3>Total Network Waste</h3>
                  <p class="value">${totalWaste} B</p>
                  <p style="font-size: 12px; margin-top: 5px;">Dead JSON payload capacity</p>
              </div>
              <div class="card accent">
                  <h3>Estimated Carbon Footprint</h3>
                  <p class="value">${co2Estimate}</p>
                  <p style="font-size: 12px; margin-top: 5px;">gCO2eq at 1M requests/month</p>
              </div>
          </div>

          <h2>Dead Field Ledger</h2>
          <table>
              <thead>
                  <tr>
                      <th>Endpoint</th>
                      <th>Dead Field Name</th>
                      <th>Waste Score</th>
                      <th>Action</th>
                  </tr>
              </thead>
              <tbody>
                  ${emptyState}
              </tbody>
          </table>

          <script nonce="${nonce}">
              const vscode = acquireVsCodeApi();
              document.querySelectorAll('.reveal-btn').forEach(btn => {
                  btn.addEventListener('click', () => {
                      if (btn.dataset.uri && btn.dataset.line != null) {
                          vscode.postMessage({
                              command: 'reveal',
                              uri: btn.dataset.uri,
                              line: parseInt(btn.dataset.line, 10)
                          });
                      }
                  });
              });
          </script>
      </body>
      </html>
    `;
  }

  public dispose() {
    GreenFieldPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}