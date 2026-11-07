'use strict';
const crypto=require('crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
/** A review exception is valid only for both immutable source versions. */
function assessReviewedBoundary(manifest,{readBaseline,readCurrent,hasEvidence}){
 const errors=[],validPaths=new Set();
 if(manifest?.schemaVersion!==1 || !manifest.paths || !manifest.exceptions)return {errors:['Invalid integration review manifest'],validPaths};
 for(const [file,record] of Object.entries(manifest.paths)){
  const reject=message=>errors.push(`${file} :: ${message}`);
  if(!record.reason || !Array.isArray(record.evidence) || !record.evidence.length){reject('review rationale or evidence missing');continue}
  const baseline=readBaseline(file),current=readCurrent(file);
  if(record.baselineSha256===null ? baseline!==null : baseline===null || hash(baseline)!==record.baselineSha256){reject('reviewed baseline changed');continue}
  if(current===null || hash(current)!==record.currentSha256){reject('reviewed implementation changed');continue}
  if(record.evidence.some(path=>!hasEvidence(path))){reject('review evidence file missing');continue}
  validPaths.add(file);
 }
 for(const [key,file] of Object.entries(manifest.exceptions))
  if(!manifest.paths[file] || key.split(' :: ')[0]!==file)errors.push(`${key} :: invalid exception target`);
 return {errors,validPaths};
}
function classifyBoundaryDifferences(failures,manifest,review){
 const reviewed=[],remaining=[];
 for(const key of failures){
  const file=manifest.exceptions?.[key];
  if(file && review.validPaths.has(file))reviewed.push({key,file,reason:manifest.paths[file].reason});
  else remaining.push(key);
 }
 return {reviewed,remaining};
}
module.exports={assessReviewedBoundary,classifyBoundaryDifferences};
