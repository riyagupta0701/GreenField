import * as vscode from 'vscode';
import { FieldSet, Field, Location } from '../types';

function getFieldLocation(field: Field): { uri: vscode.Uri, range: vscode.Range } | null {
  if (!field.definedAt) return null;

  if (typeof field.definedAt === 'string') {
    const lastColonIdx = field.definedAt.lastIndexOf(':');
    if (lastColonIdx === -1) return null;

    const pathPart = field.definedAt.substring(0, lastColonIdx);
    const linePart = field.definedAt.substring(lastColonIdx + 1);
    const line = parseInt(linePart, 10);
    
    if (isNaN(line)) return null;

    // Line is 1-indexed in the string, convert to 0-indexed for VS Code
    const zeroIndexedLine = Math.max(0, line - 1);

    return {
      uri: vscode.Uri.file(pathPart),
      range: new vscode.Range(zeroIndexedLine, 0, zeroIndexedLine, 1000)
    };
  } else if (typeof field.definedAt === 'object' && field.definedAt.uri) {
    // Handle the old mock / strict Location object format if it's still floating around
    const loc = field.definedAt;
    return {
      uri: vscode.Uri.parse(loc.uri),
      range: new vscode.Range(
        Math.max(0, loc.range.startLine),
        loc.range.startCharacter,
        Math.max(0, loc.range.endLine),
        loc.range.endCharacter
      )
    };
  }
  return null;
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

  update(fieldSets: FieldSet[], globalAnalysis?: Record<string, Field[]>): void {
    this.diagnosticCollection.clear();
    this.documentData.clear();

    const allDeadFields: Field[] = [];

    // 1. Gather exact mapped dead fields
    for (const fs of fieldSets) {
      if (!fs.deadFields) continue;
      allDeadFields.push(...fs.deadFields);
    }

    // 2. Gather globally analyzed dead fields
    if (globalAnalysis) {
      for (const fields of Object.values(globalAnalysis)) {
        allDeadFields.push(...fields);
      }
    }

    for (const field of allDeadFields) {
      const locInfo = getFieldLocation(field);
      if (!locInfo) continue;
      
      // Normalize the URI string right away so it matches VS Code's internal serialization
      const normalizedUri = locInfo.uri;
      const uriString = normalizedUri.toString();
      
      let docData = this.documentData.get(uriString);
      
      if (!docData) {
        docData = { uri: normalizedUri, diagnostics: [], fields: [] };
        this.documentData.set(uriString, docData);
      }

      const diagnostic = new vscode.Diagnostic(
        locInfo.range,
        `GreenField: '${field.name}' is defined but never accessed by the ${field.side === 'response' ? 'frontend' : 'backend'}. Estimated waste: ~${field.wasteScore.toFixed(2)} bytes/req`,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.code = 'greenfield-dead-field';
      
      docData.diagnostics.push(diagnostic);
      docData.fields.push(field);
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
      const locInfo = getFieldLocation(field);
      if (!locInfo) continue;
      
      const range = locInfo.range;
      
      if (range.contains(position)) {
        return field;
      }
    }
    return undefined;
  }

  handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    // Only wipe out the diagnostics for this specific file if there is an actual text change.
    // Make sure we use the same URI serialization string we use when setting the Map
    const uriStr = event.document.uri.toString();
    if (this.documentData.has(uriStr) && event.contentChanges.length > 0) {
      this.diagnosticCollection.delete(event.document.uri);
    }
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}