import * as vscode from 'vscode';
import { FieldSet, Field, Location } from '../types';

function hasLocation(field: Field): field is Field & { definedAt: Location } {
  return !!field.definedAt && typeof field.definedAt !== 'string' && typeof field.definedAt.uri === 'string';
}

interface DocumentDiagnostics {
  uri: vscode.Uri;
  diagnostics: vscode.Diagnostic[];
  fields: Field[];
}

export class GreenFieldDiagnosticProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private documentData = new Map<string, DocumentDiagnostics>();

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('greenfield');
  }

  private buildRange(loc: Location): vscode.Range {
    return new vscode.Range(
      Math.max(0, loc.range.startLine),
      loc.range.startCharacter,
      Math.max(0, loc.range.endLine),
      loc.range.endCharacter
    );
  }

  update(fieldSets: FieldSet[]): void {
    this.diagnosticCollection.clear();
    this.documentData.clear();

    for (const fs of fieldSets) {
      if (!fs.deadFields) continue;
      for (const field of fs.deadFields) {
        if (!hasLocation(field)) continue;
        
        // Normalize the URI string right away so it matches VS Code's internal serialization
        // This prevents map lookup misses caused by AST strings having different encoding/slashes.
        const normalizedUri = vscode.Uri.parse(field.definedAt.uri);
        const uriString = normalizedUri.toString();
        
        let docData = this.documentData.get(uriString);
        
        if (!docData) {
          docData = { uri: normalizedUri, diagnostics: [], fields: [] };
          this.documentData.set(uriString, docData);
        }

        const range = this.buildRange(field.definedAt);

        const diagnostic = new vscode.Diagnostic(
          range,
          `GreenField: '${field.name}' is defined but never accessed by the ${field.side === 'response' ? 'frontend' : 'backend'}. Estimated waste: ~${field.wasteScore.toFixed(2)} bytes/req`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = 'greenfield-dead-field';
        
        docData.diagnostics.push(diagnostic);
        docData.fields.push(field);
      }
    }

    // Apply squiggles using the safely stored URI objects
    for (const data of this.documentData.values()) {
      this.diagnosticCollection.set(data.uri, data.diagnostics);
    }
  }

  getAssociatedField(uri: vscode.Uri, position: vscode.Position): Field | undefined {
    const docData = this.documentData.get(uri.toString());
    if (!docData) return undefined;

    // Narrowed down to only the fields in this specific file
    for (const field of docData.fields) {
      if (!hasLocation(field)) continue;
      
      const range = this.buildRange(field.definedAt);
      
      if (range.contains(position)) {
        return field;
      }
    }
    return undefined;
  }

  // Document version awareness (Anti-drift)
  handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const uriStr = event.document.uri.toString();
    if (this.documentData.has(uriStr) && event.contentChanges.length > 0) {
      // Clear the diagnostics immediately if the user types anything, 
      // preventing the squiggles from drifting to the wrong lines.
      // They will be safely re-calculated on the next "Save".
      this.diagnosticCollection.delete(event.document.uri);
      this.documentData.delete(uriStr);
    }
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}