// dead_response_fields = Defined(backend response) − Accessed(frontend)
// dead_request_fields  = Defined(frontend request) − Accessed(backend)
import { Field, FieldSet } from '../types';

export function computeDiff(defined: Field[], accessed: Field[]): Field[] {
  const accessedNames = new Set(accessed.map(f => f.name));
  return defined.filter(f => !accessedNames.has(f.name));
}

