import type {SphereFixture} from './sphereForward.ts';
import type {LocalFsaverageBEM} from './fsaverageBEM.ts';
/** Runtime-only immutable model ownership; JSON exports keep the named geometry/operator.
 * Source-series identity survives reference/provenance clones. Weak keys release old models.
 */
export type ForwardContext={sphere:SphereFixture;bem?:never}|{bem:LocalFsaverageBEM;sphere?:never};
const contexts=new WeakMap<object,ForwardContext>();
export function setForwardContext(key:object|undefined,context:ForwardContext):void {if(key)contexts.set(key,context);}
export function getForwardContext(key:object|undefined):ForwardContext|undefined{return key?contexts.get(key):undefined;}
