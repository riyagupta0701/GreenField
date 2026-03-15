// Minimal vscode mock for running tests outside the VS Code host
export const languages = {
  createDiagnosticCollection: () => ({ dispose: () => {} }),
};
export const window = {
  createStatusBarItem: () => ({ text: '', show: () => {} }),
  showInformationMessage: () => {},
  showTextDocument: () => {},
};
export const workspace = {
  findFiles: async () => [],
  fs: { readFile: async () => Buffer.from('') },
  openTextDocument: async () => ({}),
};
export const commands = {
  registerCommand: (_: string, cb: Function) => ({ dispose: () => {} }),
};
export const Uri = { file: (p: string) => ({ fsPath: p }) };

export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum DiagnosticSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }

export class Diagnostic {
  constructor(public range: any, public message: string, public severity?: DiagnosticSeverity) {}
}
export class Range {
  constructor(public start: any, public end: any) {}
}
export class Position {
  constructor(public line: number, public character: number) {}
}
export class Hover {
  constructor(public contents: any) {}
}
export class CodeAction {
  constructor(public title: string, public kind?: any) {}
}
export const CodeActionKind = { QuickFix: 'quickfix' };
