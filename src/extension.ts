import * as vscode from 'vscode';
import { mapEndpoints } from "./endpointMapper";
import { extractFields as goExtractFields } from "./parsers/go/fieldExtractor";
import { trackUsage as goTrackUsage } from "./parsers/go/usageTracker";
import { createStatusBar } from "./ui/statusBar";

export function activate(context: vscode.ExtensionContext) {
  const status = createStatusBar();

  const command = vscode.commands.registerCommand(
    'greenfield.scanWorkspace',
    async () => {
      const files = await vscode.workspace.findFiles(
        "**/*.{ts,tsx,js,jsx,py,java,go}",
        "**/{node_modules,dist,build,.git,coverage,target,.next,__pycache__,vendor}/**"
      );

      const contents = await Promise.all(
        files.map(async (f: vscode.Uri) => ({
          path: f.fsPath,
          content: Buffer.from(await vscode.workspace.fs.readFile(f)).toString("utf8")
        }))
      );

      const endpoints = mapEndpoints(contents);

      // Go backend: collect response fields and request field reads
      const goFiles = files.filter(f => f.fsPath.endsWith('.go'));
      let goResponseFields = 0;
      let goRequestFields = 0;
      for (const f of goFiles) {
        try {
          goResponseFields += goExtractFields(f.fsPath).filter(field => field.side === 'response').length;
          goRequestFields  += goTrackUsage(f.fsPath).length;
        } catch { /* skip unparseable files */ }
      }

      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(endpoints, null, 2),
        language: "json"
      });

      await vscode.window.showTextDocument(doc);

      status.text = `⚡ GreenField: ${endpoints.length} endpoints`;

      vscode.window.showInformationMessage(
        `GreenField mapped ${endpoints.length} endpoints` +
        (goFiles.length > 0
          ? ` | Go: ${goResponseFields} response fields, ${goRequestFields} request fields`
          : '')
      );
    }
  );

  context.subscriptions.push(command, status);
}

export function deactivate() {}
