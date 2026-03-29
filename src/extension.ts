import * as vscode from 'vscode';
import { mapEndpoints } from "./endpointMapper";
import { extractFields as tsExtractFields, trackUsage as tsTrackUsage, extractBackendResponseFields as tsExtractBackendFields } from "./parsers/typescript";
import { extractFields as pyExtractFields } from "./parsers/python/fieldExtractor";
import { trackUsage as pyTrackUsage } from "./parsers/python/usageTracker";
import { extractFields as javaExtractFields } from "./parsers/java/fieldExtractor";
import { trackUsage as javaTrackUsage } from "./parsers/java/usageTracker";
import { extractFields as goExtractFields } from "./parsers/go/fieldExtractor";
import { trackUsage as goTrackUsage } from "./parsers/go/usageTracker";
import { createStatusBar } from "./ui/statusBar";
import { GreenFieldDiagnosticProvider } from "./ui/diagnosticProvider";
import { GreenFieldHoverProvider } from "./ui/hoverProvider";
import { GreenFieldQuickFixProvider } from "./ui/quickFix";
import { GreenFieldPanel } from "./ui/panel";
import { runDiff, scoreWaste } from "./diffEngine";
import { Endpoint, FieldSet } from "./types";

/**
 * Build a FieldSet for an endpoint using the appropriate parsers.
 *
 * Coverage:
 *   Python backend  → response fields (pyExtractFields + tsTrackUsage)
 *   Java backend    → request fields  (tsExtractFields + javaTrackUsage)
 *   Go backend      → response fields (goExtractFields + tsTrackUsage)
 *   TS/JS backend   → response fields from res.json({...}) calls
 */
function buildFieldSet(endpoint: Endpoint): FieldSet | null {
  const { backendFile, frontendFiles } = endpoint;
  if (!backendFile || frontendFiles.length === 0) return null;

  if (backendFile.endsWith('.py')) {
    return {
      endpoint,
      definedFields:  pyExtractFields(backendFile),
      accessedFields: frontendFiles.flatMap(f => tsTrackUsage(f)),
      deadFields: []
    };
  }

  if (backendFile.endsWith('.java')) {
    return {
      endpoint,
      definedFields:  frontendFiles.flatMap(f => tsExtractFields(f)),
      accessedFields: javaTrackUsage(backendFile),
      deadFields: []
    };
  }

  if (backendFile.endsWith('.go')) {
    return {
      endpoint,
      definedFields:  goExtractFields(backendFile),
      accessedFields: frontendFiles.flatMap(f => tsTrackUsage(f)),
      deadFields: []
    };
  }

  // TS/JS backend — response fields from res.json({...}) calls
  if (backendFile.match(/\.[jt]sx?$/)) {
    return {
      endpoint,
      definedFields:  tsExtractBackendFields(backendFile),
      accessedFields: frontendFiles.flatMap(f => tsTrackUsage(f)),
      deadFields: []
    };
  }

  return null;
}

export function activate(context: vscode.ExtensionContext) {
  const status = createStatusBar();

  // Initialize UI components
  const diagnosticProvider = new GreenFieldDiagnosticProvider();
  
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      new GreenFieldHoverProvider(diagnosticProvider)
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new GreenFieldQuickFixProvider(diagnosticProvider),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
      }
    ),
    vscode.workspace.onDidChangeTextDocument((e) => diagnosticProvider.handleDocumentChange(e)),
    vscode.workspace.onDidSaveTextDocument((document) => {
      // Re-run the scan command when a file is saved so the UI stays up to date
      const supportedLangs = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python', 'java', 'go'];
      if (supportedLangs.includes(document.languageId)) {
        // Pass 'true' so the scan is silent and doesnt steal focus
        vscode.commands.executeCommand('greenfield.scanWorkspace', true);
      }
    })
  );

  const command = vscode.commands.registerCommand(
    'greenfield.scanWorkspace',
    async (...args: any[]) => {
      // Check if any argument passed is the literal boolean `true`
      const silent = args.includes(true);
      
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

      // Run diff only where parsers are available (Python/Java/Go/TS backends).
      const fieldSets: FieldSet[] = endpoints
        .map(buildFieldSet)
        .filter((fs): fs is FieldSet => fs !== null)
        .map(fs => runDiff(fs));

      const tsFiles   = files.filter(f => /\.[tj]sx?$/.test(f.fsPath));
      const pyFiles   = files.filter(f => f.fsPath.endsWith('.py'));
      const javaFiles = files.filter(f => f.fsPath.endsWith('.java'));
      const goFiles   = files.filter(f => f.fsPath.endsWith('.go'));

      // Global fallback analysis: compare all backend response fields against all
      // frontend-accessed names. Catches repos where URL matching fails (e.g. Go
      // sub-router patterns like Mattermost).
      const allAccessedNames = new Set(
        tsFiles.flatMap(f => { try { return tsTrackUsage(f.fsPath); } catch { return []; } })
               .map(f => f.name)
      );

      function globalDeadFields(extractFn: (p: string, ...args: any[]) => import('./types').Field[], langFiles: vscode.Uri[]) {
        return langFiles.flatMap(f => {
          try {
            return extractFn(f.fsPath)
              .filter(field => field.side === 'response' && !allAccessedNames.has(field.name))
              .map(field => ({ ...field, wasteScore: scoreWaste(field) }));
          }
          catch { return []; }
        });
      }

      const globalAnalysis = {
        go:   globalDeadFields(goExtractFields,   goFiles),
        py:   globalDeadFields(pyExtractFields,   pyFiles),
        java: globalDeadFields(javaExtractFields, javaFiles),
        ts:   globalDeadFields(tsExtractBackendFields, tsFiles),
      };

      const totalGlobalDead = Object.values(globalAnalysis).reduce((n, arr) => n + arr.length, 0);
      const totalGlobalWasteBytes = Object.values(globalAnalysis).flat().reduce((s, f) => s + (f.wasteScore ?? 0), 0);

      const totalDead = fieldSets.reduce((n, fs) => n + (fs.deadFields?.length ?? 0), 0) + totalGlobalDead;
      const totalWasteBytes = fieldSets.reduce((n, fs) =>
        n + (fs.deadFields?.reduce((s, f) => s + (f.wasteScore ?? 0), 0) ?? 0), 0) + totalGlobalWasteBytes;

      const langCounts: { lang: string; files: number }[] = [
        { lang: 'TS',   files: tsFiles.length   },
        { lang: 'Py',   files: pyFiles.length   },
        { lang: 'Java', files: javaFiles.length },
        { lang: 'Go',   files: goFiles.length   },
      ].filter(l => l.files > 0);

      const langSummary = langCounts.map(l => `${l.lang}: ${l.files} files`).join(' | ');

      // Update UI components with exact endpoint matches and global matches
      diagnosticProvider.update(fieldSets, globalAnalysis);

      const kb = (totalWasteBytes / 1000).toFixed(1);
      status.text = `⚡ GreenField: ${endpoints.length} endpoints | ${totalDead} dead fields | ~${kb} KB/req wasted`;

      // If we are doing a silent background scan (e.g. on file save), we don't 
      // want to pop open the Dashboard or JSON document, just update diagnostics and status bar.
      if (!silent) {
        // Open Webview Panel to show results
        const panel = GreenFieldPanel.createOrShow(context.extensionUri);
        panel.update(fieldSets, globalAnalysis);

        // Always show all endpoints; annotate with dead fields where available
        const output = {
          endpoints,
          deadFieldAnalysis: fieldSets,
          globalDeadFieldAnalysis: globalAnalysis,
        };

        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(output, null, 2),
          language: "json"
        });

        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

        vscode.window.showInformationMessage(
          `GreenField: ${endpoints.length} endpoints mapped, ${totalDead} dead fields found (${kb} KB/req wasted)` +
          (langSummary ? ` | ${langSummary}` : '')
        );
      } else {
        // If it's silent, just update the panel if it happens to be open in the background, 
        // without stealing focus.
        if (GreenFieldPanel.currentPanel) {
          GreenFieldPanel.currentPanel.update(fieldSets, globalAnalysis);
        }
      }
    }
  );

  context.subscriptions.push(command, status);
}

export function deactivate() {}
