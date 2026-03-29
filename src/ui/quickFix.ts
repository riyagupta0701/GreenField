import * as vscode from 'vscode';
import { GreenFieldDiagnosticProvider } from './diagnosticProvider';

export class GreenFieldQuickFixProvider implements vscode.CodeActionProvider {
  constructor(private diagnosticProvider: GreenFieldDiagnosticProvider) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    // Filter diagnostics to only our own
    const greenFieldDiagnostics = context.diagnostics.filter(
      (diag) => diag.code === 'greenfield-dead-field'
    );

    for (const diagnostic of greenFieldDiagnostics) {
      // Create a Quick Fix action. Note: Because deleting lines inside JSON/TS objects 
      // can leave trailing commas or empty braces, manual review is recommended.
      const action = new vscode.CodeAction(
        '🌱 Remove dead field to save energy (Review after applying)',
        vscode.CodeActionKind.QuickFix
      );

      // Make the action edit the workspace to delete the ENTIRE LINE 
      action.edit = new vscode.WorkspaceEdit();
      
      // Instead of just deleting the narrow range of the variable name, 
      // let's create a range that spans the entirety of the line, including the line break.
      const lineToDelete = document.lineAt(diagnostic.range.start.line);
      const rangeIncLineBreak = lineToDelete.rangeIncludingLineBreak;
      
      action.edit.delete(document.uri, rangeIncLineBreak);
      
      // Associate with the specific diagnostic
      action.diagnostics = [diagnostic];
      
      // Removed 'isPreferred = true' because line-deletion is destructive and 
      // can leave behind dangling commas or empty structs (which require manual review).
      // We do not want this triggering automatically on "Fix All on Save".

      actions.push(action);
    }

    return actions;
  }
}