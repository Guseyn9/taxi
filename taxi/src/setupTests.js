// Project test bootstrap. Kept intentionally small so old CRA/Jest config can run pure resolver tests.
// These browser globals are not supplied by jsdom; Router uses the standard APIs.
const {TextEncoder,TextDecoder}=require('node:util')
if(!global.TextEncoder)global.TextEncoder=TextEncoder
if(!global.TextDecoder)global.TextDecoder=TextDecoder

// Dedicated browser workers are exercised in browser QA, not emulated in jsdom.
jest.mock('./graph/workerFactory',()=>({createGraphWorker:()=>{throw new Error('Browser worker unavailable in jsdom')}}))
