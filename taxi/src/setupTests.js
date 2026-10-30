// Project test bootstrap. Kept intentionally small so old CRA/Jest config can run pure resolver tests.

// Dedicated browser workers are exercised in browser QA, not emulated in jsdom.
jest.mock('./graph/workerFactory',()=>({createGraphWorker:()=>{throw new Error('Browser worker unavailable in jsdom')}}))
