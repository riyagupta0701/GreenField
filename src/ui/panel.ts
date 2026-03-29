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

  public update(fieldSets: FieldSet[], globalAnalysis?: Record<string, import('../types').Field[]>): void {
    const webview = this._panel.webview;
    this._panel.title = '🌱 GreenField Dashboard';
    this._panel.webview.html = this.getHtmlForWebview(webview, fieldSets, globalAnalysis);
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

  private getHtmlForWebview(webview: vscode.Webview, fieldSets: FieldSet[], globalAnalysis?: Record<string, import('../types').Field[]>): string {
    const nonce = this.getNonce();
    let totalWaste = 0;
        // Helper to format numbers with commas
        function formatWithCommas(x: number): string {
          return x.toLocaleString();
        }

        // Helper to convert number to English words (short, for millions/billions)
        function numberToWords(num: number): string {
          if (num >= 1_000_000_000) {
            const billions = Math.floor(num / 1_000_000_000);
            const millions = Math.floor((num % 1_000_000_000) / 1_000_000);
            const thousands = Math.floor((num % 1_000_000) / 1_000);
            let result = `${billions} billion`;
            if (millions > 0) result += ` ${millions} million`;
            if (thousands > 0) result += ` ${thousands} thousand`;
            return result + ' bytes';
          } else if (num >= 1_000_000) {
            const millions = Math.floor(num / 1_000_000);
            const thousands = Math.floor((num % 1_000_000) / 1_000);
            let result = `${millions} million`;
            if (thousands > 0) result += ` ${thousands} thousand`;
            return result + ' bytes';
          } else if (num >= 1_000) {
            const thousands = Math.floor(num / 1_000);
            return `${thousands} thousand bytes`;
          } else {
            return `${num} bytes`;
          }
        }
    
    // Safety check just in case endpoints passed is undefined/null
    const safeFieldSets = Array.isArray(fieldSets) ? fieldSets : [];

    const rows = safeFieldSets.flatMap(fs => 
      fs.deadFields?.map(df => {
        totalWaste += df.wasteScore;
        let fileUri = '';
        let startLine = 0;
        if (typeof df.definedAt === 'string') {
          const lastColonIdx = df.definedAt.lastIndexOf(':');
          if (lastColonIdx !== -1) {
            fileUri = vscode.Uri.file(df.definedAt.substring(0, lastColonIdx)).toString();
            startLine = Math.max(0, parseInt(df.definedAt.substring(lastColonIdx + 1), 10) - 1) || 0;
          } else {
            fileUri = vscode.Uri.file(df.definedAt).toString();
          }
        } else {
          fileUri = df.definedAt.uri.toString();
          startLine = df.definedAt.range.startLine;
        }
        // Extract file name from URI
        let fileName = '';
        try {
          const path = vscode.Uri.parse(fileUri).fsPath;
          fileName = path.split(/[\\/]/).pop() || path;
        } catch {
          fileName = fileUri;
        }
        const safeName = this.escapeHtml(df.name);
        const safeUri = this.escapeHtml(fileUri);
        const safeFileName = this.escapeHtml(fileName);
        const wasteScoreKB = df.wasteScore / 1000;
        const wasteScoreKBWithCommas = formatWithCommas(Math.round(wasteScoreKB));
        return `
          <tr>
            <td><code>${safeFileName}</code></td>
            <td><code>${safeName}</code></td>
            <td class="waste-score">${wasteScoreKBWithCommas} KB</td>
            <td>
              <button class="reveal-btn" data-uri="${safeUri}" data-line="${startLine}">
                Jump to file
              </button>
            </td>
          </tr>
        `;
      }) || []
    ).join('');

    let globalRows = '';
    if (globalAnalysis) {
      const globalFields = Object.values(globalAnalysis).flat();
      globalRows = globalFields.map(df => {
        totalWaste += df.wasteScore || 0;
        let fileUri = '';
        let startLine = 0;
        if (typeof df.definedAt === 'string') {
          const lastColonIdx = df.definedAt.lastIndexOf(':');
          if (lastColonIdx !== -1) {
            fileUri = vscode.Uri.file(df.definedAt.substring(0, lastColonIdx)).toString();
            startLine = Math.max(0, parseInt(df.definedAt.substring(lastColonIdx + 1), 10) - 1) || 0;
          } else {
            fileUri = vscode.Uri.file(df.definedAt).toString();
          }
        } else {
          fileUri = df.definedAt.uri.toString();
          startLine = df.definedAt.range.startLine;
        }
        // Extract file name from URI
        let fileName = '';
        try {
          const path = vscode.Uri.parse(fileUri).fsPath;
          fileName = path.split(/[\\/]/).pop() || path;
        } catch {
          fileName = fileUri;
        }
        const safeName = this.escapeHtml(df.name);
        const safeUri = this.escapeHtml(fileUri);
        const safeFileName = this.escapeHtml(fileName);
        const wasteScoreKB = (df.wasteScore || 0) / 1000;
        const wasteScoreKBWithCommas = formatWithCommas(Math.round(wasteScoreKB));
        return `
          <tr>
            <td><code>${safeFileName}</code></td>
            <td><code>${safeName}</code></td>
            <td class="waste-score">${wasteScoreKBWithCommas} KB</td>
            <td>
              <button class="reveal-btn" data-uri="${safeUri}" data-line="${startLine}">
                Jump to file
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // To calculate the estimated CO₂ emissions of wasted payload bytes, this calculation utilizes a conservative emissions coefficient of 0.06916 gCO₂e per MB.
    // This is derived by multiplying the network and data center operational and embodied energy intensity (0.14 kWh/GB, excluding user devices, based on the Sustainable Web Design Model V4)
    // by the global average grid carbon intensity of 494 gCO₂e/kWh: 0.14 kWh/GB × 494 g/kWh = 69.16 g/GB = 0.06916 g/MB = 0.00000006916 g/byte.
    // Citation: Sustainable Web Design Model V4, global grid intensity from Ember 2023.
    const CO2_PER_BYTE = 0.00000006916;
    const co2Estimate = (totalWaste * CO2_PER_BYTE).toFixed(6); // 6 decimals for reasonable precision
    // Format for display
    const totalWasteKB = totalWaste / 1000;
    const totalWasteKBWithCommas = formatWithCommas(Math.round(totalWasteKB));
    const totalWasteInWords = numberToWords(totalWaste);
    // Carbon: show as grams CO2e per day, rounded, with label
    const co2EstimateRounded = Number(co2Estimate).toLocaleString(undefined, { maximumFractionDigits: 3 });
    
    // Calculate total rows to see if we show the empty state
    const hasAnyRows = (rows.length > 0) || (globalRows.length > 0);

    const emptyState = !hasAnyRows
      ? `<tr><td colspan="4" class="empty-state">🎉 You have zero dead fields! Your data is fully sustainable.</td></tr>`
      : (rows + globalRows);

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>GreenField Dashboard</title>
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
          <h1>GreenField Dashboard</h1>
          

            <div class="summary-cards">
              <div class="card">
                <h3>Total Network Waste</h3>
                <p class="value">${totalWasteKBWithCommas} KB</p>
                <p style="font-size: 13px; color: #aaa; margin: 0;">(${totalWasteInWords})</p>
                <p style="font-size: 12px; margin-top: 5px;">Dead JSON payload capacity per day</p>
              </div>
              <div class="card accent">
                <h3>Estimated Carbon Footprint per Day</h3>
                <p class="value">${co2EstimateRounded} grams CO₂e / day</p>
                <p style="font-size: 12px; margin-top: 5px; color: #888;">Based on daily dead payload volume</p>
              </div>
            </div>

            <h2>Dead Field Ledger</h2>
            <table>
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Dead Field Name</th>
                  <th>Waste Score (per day)</th>
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