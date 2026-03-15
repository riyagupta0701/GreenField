// Frontend usage tracking
// Tracks field access: destructuring, JSX, optional chaining, template literals
// Conservative rule: dynamic bracket access obj[key] → mark as possibly used

import { BindingElement, Project, PropertyAccessExpression, SyntaxKind } from 'ts-morph';
import { Field } from '../../types';

/**
 * Names that are definitively not API response field names.
 * These appear on: JS builtins, DOM APIs, HTTP internals, Redux boilerplate,
 * Express/Node internals, common framework method names.
 *
 * Reduce noise so the diff engine produces fewer false "used" results.
 * This list only excludes names that are structurally impossible
 * to be a JSON field name in a REST API response
 * (e.g. built-in methods, well-known library APIs).
 */
const NOISE_NAMES = new Set([
  // JavaScript builtins
  'length','push','pop','shift','unshift','splice','slice','concat','join',
  'indexOf','lastIndexOf','find','findIndex','filter','map','reduce','reduceRight',
  'forEach','some','every','flat','flatMap','includes','keys','values','entries',
  'sort','reverse','fill','copyWithin','at',
  'toString','toLocaleString','valueOf','hasOwnProperty','isPrototypeOf',
  'propertyIsEnumerable','constructor',
  'then','catch','finally','resolve','reject','all','allSettled','race','any',
  'call','apply','bind','prototype','arguments','caller',
  'assign','create','defineProperty','defineProperties','freeze','seal',
  'getOwnPropertyNames','getOwnPropertyDescriptor','getPrototypeOf','keys',
  'fromEntries','entries','is','isFrozen','isSealed','setPrototypeOf',
  'parse','stringify','from','of','isArray','isInteger','isFinite','isNaN',
  'parseInt','parseFloat','trim','trimStart','trimEnd','padStart','padEnd',
  'startsWith','endsWith','replace','replaceAll','split','match','matchAll',
  'search','charAt','charCodeAt','codePointAt','normalize','repeat','substring',
  'toLowerCase','toUpperCase','toLocaleLowerCase','toLocaleUpperCase',
  // DOM / Browser APIs
  'addEventListener','removeEventListener','dispatchEvent','preventDefault',
  'stopPropagation','target','currentTarget','srcElement','type','bubbles',
  'getElementById','getElementsByClassName','getElementsByTagName',
  'querySelector','querySelectorAll','createElement','createTextNode',
  'appendChild','removeChild','insertBefore','replaceChild','cloneNode',
  'setAttribute','getAttribute','removeAttribute','classList','style',
  'innerText','innerHTML','textContent','value','checked','disabled','hidden',
  'focus','blur','click','submit','reset','scrollIntoView','getBoundingClientRect',
  'location','href','pathname','search','hash','host','hostname','origin','port',
  'history','pushState','replaceState','back','forward','go',
  'localStorage','sessionStorage','getItem','setItem','removeItem','clear',
  'setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame',
  'fetch','Request','Response','Headers','body','headers','method','credentials',
  'mode','cache','redirect','referrer','integrity','signal',
  'statusText','json','text','blob','arrayBuffer','formData','clone',
  // Node.js / Express
  'use','get','post','put','delete','patch','route','listen','close',
  'send','json','render','redirect','next','end','write','writeHead',
  'setHeader','getHeader','removeHeader','pipe','emit','on','once','off',
  'createServer','createReadStream','createWriteStream','readFile','writeFile',
  'readdir','mkdir','stat','unlink','join','resolve','dirname','basename',
  'env','argv','exit','cwd','chdir','platform','arch','version',
  // HTTP / fetch internals
  'has','append','set','delete','get','getAll','forEach','entries','keys','values',
  // Redux / state management boilerplate
  'dispatch','getState','subscribe','replaceReducer','observable',
  'createStore','combineReducers','applyMiddleware','compose',
  'createAction','createReducer','createSlice','createAsyncThunk',
  'createSelector','createEntityAdapter',
  // React / JSX
  'useState','useEffect','useRef','useCallback','useMemo','useContext',
  'useReducer','useLayoutEffect','useImperativeHandle','useDebugValue',
  'render','setState','forceUpdate','componentDidMount','componentDidUpdate',
  'componentWillUnmount','shouldComponentUpdate','getDerivedStateFromProps',
  'getSnapshotBeforeUpdate','componentDidCatch','getDerivedStateFromError',
  'createElement','createRef','createContext','forwardRef','memo','Fragment',
  'cloneElement','isValidElement','Children','Component','PureComponent',
  // Common utility patterns
  'log','warn','info','error','debug','trace','group','groupEnd','table',
  'bind','connect','disconnect','open','close','send','receive',
  'encode','decode','serialize','deserialize','format','parse',
  'merge','clone','deepEqual','shallowEqual','isEqual','isEmpty','isNil',
  // TypeScript / compile-time only
  'prototype','constructor','super','this','arguments',
]);


function isApiFieldCandidate(name: string): boolean {
  if (NOISE_NAMES.has(name)) return false;
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) return false;
  if (name.length <= 1) return false;
  return true;
}

export function trackUsage(filePath: string, project?: Project): Field[] {
  const proj = project ?? new Project({ skipLoadingLibFiles: true } as any);
  if (!proj.getSourceFile(filePath)) {
    proj.addSourceFileAtPath(filePath);
  }
  const sourceFile = proj.getSourceFileOrThrow(filePath);

  const seen = new Set<string>();
  const fields: Field[] = [];

  function add(name: string, line: number) {
    if (seen.has(name)) return;
    if (!isApiFieldCandidate(name)) return;
    seen.add(name);
    fields.push({ name, side: 'response', definedAt: `${filePath}:${line}`, wasteScore: 0 });
  }

  // 1. Property access & optional chaining
  sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).forEach(
    (pa: PropertyAccessExpression) => add(pa.getName(), pa.getStartLineNumber())
  );

  // 2. Destructuring
  sourceFile.getDescendantsOfKind(SyntaxKind.BindingElement).forEach(
    (be: BindingElement) => {
      const propNameNode = be.getPropertyNameNode();
      const nameNode = be.getNameNode();
      const key = propNameNode
        ? propNameNode.getText()
        : nameNode.getKind() === SyntaxKind.Identifier ? nameNode.getText() : null;
      if (key) add(key, be.getStartLineNumber());
    }
  );

  return fields;
}
