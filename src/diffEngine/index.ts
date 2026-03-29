import { FieldSet } from '../types';
import { computeDiff } from './differ';
import { scoreWaste } from './scorer';

export { computeDiff } from './differ';
export { scoreWaste, estimateCO2kWh, estimateFieldBytes, estimateDailyRequests } from './scorer';

export function runDiff(fieldSet: FieldSet): FieldSet {
  const dead = computeDiff(fieldSet.definedFields, fieldSet.accessedFields);
  const endpointPattern = fieldSet.endpoint?.pattern;
  const scored = dead.map(f => ({ ...f, wasteScore: scoreWaste(f, endpointPattern) }));
  return { ...fieldSet, deadFields: scored };
}
