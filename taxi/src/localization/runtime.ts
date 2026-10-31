type Language = {id?:string|number,iso?:string}
let reader:()=>Language|undefined=()=>undefined
/** Installed by the application store; localization itself never constructs Redux. */
export function setLocalizationLanguageReader(value:()=>Language|undefined){reader=value}
export function localizationLanguage(){return reader()}
