import * as vscode from 'vscode';

export interface Endpoint {
  pattern: string
  method: string
  backendFile: string
  frontendFiles: string[]
}

export interface Location {
  uri: string;
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
}

export interface Field {
  name: string
  side: 'request' | 'response'
  definedAt: string | Location
  wasteScore: number
}

export interface FieldSet {
  endpoint: Endpoint
  definedFields: Field[]
  accessedFields: Field[]
  deadFields?: Field[]
}