/** Backend-neutral expected canonical values; adapter assertions are not themselves evidence. */
import {isDeepStrictEqual} from 'node:util';
import {getDataAtPath} from './common.mjs';
export function evaluateOracle(testCase, actual) {
  const failures=[];
  if(!actual||typeof actual!=='object'||Array.isArray(actual))return {ok:false,failures:['Actual canonical result must be an object']};
  for(const [field,expected] of Object.entries(testCase.expectedResult)){
    const observed=getDataAtPath(actual,field);
    if(!observed.exists) failures.push(`${field}: missing`);
    else if(!isDeepStrictEqual(observed.value,expected))failures.push(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(observed.value)}`);
  }
  return {ok:failures.length===0, failures};
}
export function validateAdapterEvidence(testCase, evidence) {
  const failures=[];
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))return {ok:false,failures:['Evidence object missing']};
  for(const key of testCase.requiredEvidenceKeys){
    const val=evidence[key];
    if(val===null||val===undefined||(typeof val==='string'&&!val.trim()))failures.push(`required evidence missing: ${key}`);
  }
  return {ok:failures.length===0,failures};
}
