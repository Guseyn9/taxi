'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
function assertReportPdf(html,pdf,exporter,proof) {
  if(proof?.visualReviewed!==true||!Number.isInteger(proof.pages)||proof.pages<1)
    throw Error('The latest PDF still needs visual review')
  if(proof.htmlSha256!==hash(html))throw Error('Report PDF is stale: HTML changed')
  if(proof.pdfSha256!==hash(pdf)||!pdf.subarray(0,5).equals(Buffer.from('%PDF-')))
    throw Error('Report PDF does not match its reviewed artifact')
  if(proof.exporterSha256!==hash(exporter))throw Error('Report PDF is stale: export layout changed')
  return proof
}
function verifyReportPdf(root) {
  const dir=path.join(root,'docs/qa/frontend-completion-20261103')
  return assertReportPdf(fs.readFileSync(path.join(dir,'frontend-report.html')),
    fs.readFileSync(path.join(dir,'frontend-report.pdf')),
    fs.readFileSync(path.join(root,'tools/export-frontend-report-pdf.cjs')),
    JSON.parse(fs.readFileSync(path.join(dir,'pdf-verification.json'),'utf8')))
}
module.exports={assertReportPdf,verifyReportPdf}
